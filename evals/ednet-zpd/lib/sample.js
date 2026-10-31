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

/**
 * Parse a single EdNet KT3 CSV (headered). Columns vary slightly by dump;
 * we accept common names.
 */
function parseKt3Csv(filePath, userId, maxEvents) {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const idx = (name) => header.findIndex((h) => h.toLowerCase() === name);
  const iTs = idx("timestamp");
  const iAction = idx("action_type") >= 0 ? idx("action_type") : idx("action");
  const iItem = idx("item_id");
  const iCorrect =
    idx("correct") >= 0
      ? idx("correct")
      : idx("user_answer") >= 0
        ? -2
        : -1;
  const iTags = idx("tags") >= 0 ? idx("tags") : idx("tag");

  const events = [];
  for (let li = 1; li < lines.length; li++) {
    if (events.length >= maxEvents) break;
    const cols = splitCsvLine(lines[li]);
    const timestamp = Number(cols[iTs]);
    const action_type = cols[iAction] || "";
    const item_id = iItem >= 0 ? cols[iItem] : "";
    let correct = null;
    if (iCorrect >= 0) {
      const v = cols[iCorrect];
      if (v === "1" || v === "true" || v === "True") correct = true;
      else if (v === "0" || v === "false" || v === "False") correct = false;
    }
    const tags =
      iTags >= 0 && cols[iTags]
        ? String(cols[iTags]).split(";").map((t) => t.trim()).filter(Boolean)
        : item_id
          ? [item_id]
          : [];
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
    events.push(...parseKt3Csv(file, userId, cfg.maxEvents));
  }
  return {
    source: "ednet-kt3",
    config: cfg,
    events,
    userFiles: picked.length,
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
  parseKt3Csv,
  listUserFiles,
};
