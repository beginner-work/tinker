"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { cacheDir } = require("../download.js");
const { labelEvents } = require("./label.js");

/**
 * Mulberry32 PRNG for deterministic sampling.
 * @param {number} seed
 */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleConfig() {
  return {
    seed: Number(process.env.EDNET_SAMPLE_SEED || 42),
    maxUsers: Number(process.env.EDNET_SAMPLE_USERS || 40),
    maxEvents: Number(process.env.EDNET_SAMPLE_EVENTS || 400),
  };
}

/**
 * Tiny synthetic KT3-like fixture used when EdNet cache is absent.
 * Keeps offline unit tests and CI-without-data green.
 */
function loadSyntheticFixture() {
  const fixturePath = path.join(__dirname, "..", "fixtures", "synthetic-kt3.json");
  const raw = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  return raw.events || [];
}

function listUserFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith(".csv")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseTags(raw) {
  if (raw == null || raw === "") return [];
  return String(raw)
    .split(/[;|,]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Load EdNet Contents tables used to resolve question correctness + skill tags.
 * @returns {{
 *   questions: Map<string, {correctAnswer: string, tags: string[], bundleId: string, explanationId: string}>,
 *   lectures: Map<string, {tags: string[]}>,
 *   bundleTags: Map<string, string[]>,
 *   explanationTags: Map<string, string[]>,
 * }}
 */
function loadContentsIndex() {
  const root = path.join(cacheDir(), "contents");
  const questionsPath = path.join(root, "contents", "questions.csv");
  const lecturesPath = path.join(root, "contents", "lectures.csv");
  const questions = new Map();
  const lectures = new Map();
  const bundleTags = new Map();
  const explanationTags = new Map();

  if (fs.existsSync(questionsPath)) {
    const text = fs.readFileSync(questionsPath, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    const header = lines[0].split(",").map((h) => h.trim());
    const idx = (name) => header.findIndex((h) => h.toLowerCase() === name);
    const iId = idx("question_id");
    const iAns = idx("correct_answer");
    const iTags = idx("tags");
    const iBundle = idx("bundle_id");
    const iExpl = idx("explanation_id");
    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]);
      const id = cols[iId];
      if (!id) continue;
      const tags = parseTags(iTags >= 0 ? cols[iTags] : "");
      const bundleId = iBundle >= 0 ? cols[iBundle] : "";
      const explanationId = iExpl >= 0 ? cols[iExpl] : "";
      questions.set(id, {
        correctAnswer: iAns >= 0 ? String(cols[iAns] || "").trim() : "",
        tags,
        bundleId,
        explanationId,
      });
      if (bundleId && tags.length) {
        const prev = bundleTags.get(bundleId) || [];
        bundleTags.set(bundleId, [...new Set(prev.concat(tags))]);
      }
      if (explanationId && tags.length) {
        const prev = explanationTags.get(explanationId) || [];
        explanationTags.set(explanationId, [...new Set(prev.concat(tags))]);
      }
    }
  }

  if (fs.existsSync(lecturesPath)) {
    const text = fs.readFileSync(lecturesPath, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    const header = lines[0].split(",").map((h) => h.trim());
    const idx = (name) => header.findIndex((h) => h.toLowerCase() === name);
    const iId = idx("lecture_id");
    const iTags = idx("tags");
    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]);
      const id = cols[iId];
      if (!id) continue;
      lectures.set(id, { tags: parseTags(iTags >= 0 ? cols[iTags] : "") });
    }
  }

  return { questions, lectures, bundleTags, explanationTags };
}

/**
 * Parse a single EdNet KT3 CSV (headered), joining Contents for tags/correct.
 */
function parseKt3Csv(filePath, userId, maxEvents, contents) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const idx = (name) => header.findIndex((h) => h.toLowerCase() === name);
  const iTs = idx("timestamp");
  const iAction = idx("action_type") >= 0 ? idx("action_type") : idx("action");
  const iItem = idx("item_id");
  const iCorrectCol = idx("correct");
  const iUserAnswer = idx("user_answer");
  const iTags = idx("tags") >= 0 ? idx("tags") : idx("tag");

  const questions = (contents && contents.questions) || new Map();
  const lectures = (contents && contents.lectures) || new Map();
  const bundleTags = (contents && contents.bundleTags) || new Map();
  const explanationTags = (contents && contents.explanationTags) || new Map();

  const events = [];
  for (let li = 1; li < lines.length; li++) {
    if (events.length >= maxEvents) break;
    const cols = splitCsvLine(lines[li]);
    const timestamp = Number(cols[iTs]);
    const action_type = cols[iAction] || "";
    const item_id = iItem >= 0 ? cols[iItem] : "";
    let correct = null;
    let tags = [];

    if (iTags >= 0 && cols[iTags]) {
      tags = parseTags(cols[iTags]);
    }

    if (iCorrectCol >= 0) {
      const v = cols[iCorrectCol];
      if (v === "1" || v === "true" || v === "True") correct = true;
      else if (v === "0" || v === "false" || v === "False") correct = false;
    }

    const q = item_id ? questions.get(item_id) : null;
    if (q) {
      if (!tags.length) tags = q.tags.slice();
      if (correct == null && iUserAnswer >= 0) {
        const ans = String(cols[iUserAnswer] || "")
          .trim()
          .toLowerCase();
        const expected = String(q.correctAnswer || "")
          .trim()
          .toLowerCase();
        if (ans && expected) correct = ans === expected;
      }
    } else if (item_id && lectures.has(item_id)) {
      if (!tags.length) tags = lectures.get(item_id).tags.slice();
    } else if (item_id && bundleTags.has(item_id)) {
      if (!tags.length) tags = bundleTags.get(item_id).slice();
    } else if (item_id && explanationTags.has(item_id)) {
      if (!tags.length) tags = explanationTags.get(item_id).slice();
    }

    // Do not fall back to raw item_id as a "concept" — that invents millions of
    // singleton concepts and yields empty ZPD probes on real EdNet.
    events.push({
      userId,
      timestamp,
      action_type,
      item_id,
      tags,
      correct,
    });
  }
  return events;
}

/**
 * Load a seeded sample of events. Falls back to synthetic fixture.
 */
function loadSampleEvents() {
  const cfg = sampleConfig();
  const rng = mulberry32(cfg.seed);
  const dir = path.join(cacheDir(), "kt3");
  const files = listUserFiles(dir);

  if (!files.length) {
    return {
      source: "synthetic-fixture",
      config: cfg,
      events: loadSyntheticFixture(),
      note: "EdNet KT3 cache missing; using fixtures/synthetic-kt3.json",
    };
  }

  const contents = loadContentsIndex();
  // Deterministic shuffle of file paths.
  const shuffled = files.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const picked = shuffled.slice(0, cfg.maxUsers);
  const events = [];
  for (const file of picked) {
    const base = path.basename(file, ".csv");
    const userId = base.replace(/^u/, "") || base;
    events.push(...parseKt3Csv(file, userId, cfg.maxEvents, contents));
  }
  return {
    source: "ednet-kt3",
    config: cfg,
    events,
    userFiles: picked.length,
    contentsQuestions: contents.questions.size,
  };
}

function loadLabeledProbes() {
  const sample = loadSampleEvents();
  const probes = labelEvents(sample.events, { minHistory: 2 });
  return { ...sample, probes };
}

module.exports = {
  mulberry32,
  sampleConfig,
  loadSyntheticFixture,
  loadSampleEvents,
  loadLabeledProbes,
  loadContentsIndex,
  parseKt3Csv,
  listUserFiles,
};
