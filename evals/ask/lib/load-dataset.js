/* Load eval cases + essay fixtures for Braintrust Eval(). */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CASES_JSONL = path.join(ROOT, "dataset", "cases.jsonl");
const CASES_DIR = path.join(ROOT, "dataset", "cases");
const LEGACY_CASES_DIR = path.join(ROOT, "cases");
const ESSAYS_FIXTURE = path.join(ROOT, "fixtures", "essays.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadEssaysFixture() {
  if (!fs.existsSync(ESSAYS_FIXTURE)) return [];
  const raw = readJson(ESSAYS_FIXTURE);
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.essays)) return raw.essays;
  return [];
}

function normalizeCase(raw) {
  if (!raw || typeof raw !== "object") return null;
  const question = String(raw.question || "").trim();
  if (!question || !raw.id) return null;
  const source = String(raw.source || "synthetic").trim();
  const tyler =
    raw.tyler_answer == null || raw.tyler_answer === ""
      ? null
      : String(raw.tyler_answer);
  return {
    id: String(raw.id),
    question,
    source:
      source === "essay" ||
      source === "visitor" ||
      source === "synthetic" ||
      source === "linkedin"
        ? source
        : "synthetic",
    tyler_answer: tyler,
    essayId: raw.essayId || null,
    essayTitle: raw.essayTitle || null,
    promptIndex: raw.promptIndex == null ? null : Number(raw.promptIndex),
    category: String(raw.category || (tyler ? "agreement" : "grounded")),
    input: raw.input === "voice" ? "voice" : "typed",
    rawTranscript: raw.rawTranscript || "",
    position: raw.position || null,
    context: raw.context || "",
    sourceId: raw.sourceId || "lindowlabs-minds-and-models",
    expect: raw.expect || {},
    notes: raw.notes || "",
  };
}

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function loadDirCases(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => readJson(path.join(dir, n)));
}

function loadCases() {
  const fromJsonl = loadJsonl(CASES_JSONL);
  const fromDir = loadDirCases(CASES_DIR);
  const legacy = loadDirCases(LEGACY_CASES_DIR).map((c) => ({
    ...c,
    source: c.source || "synthetic",
    tyler_answer: c.tyler_answer != null ? c.tyler_answer : null,
    category: c.category || inferLegacyCategory(c),
  }));
  const merged = [...fromJsonl, ...fromDir, ...legacy];
  const byId = new Map();
  for (const raw of merged) {
    const c = normalizeCase(raw);
    if (!c) continue;
    byId.set(c.id, c);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function inferLegacyCategory(c) {
  const id = String(c.id || "");
  if (/unknown|refusal/i.test(id)) return "refusal";
  if (/inject/i.test(id)) return "prompt_injection";
  if (/off.?topic/i.test(id)) return "off_topic";
  if (c.input === "voice") return "voice_messy";
  return "grounded";
}

/** Braintrust data() rows. */
function toEvalRows(cases) {
  return cases.map((c) => ({
    input: {
      id: c.id,
      question: c.question,
      source: c.source,
      category: c.category,
      essayId: c.essayId,
      input: c.input,
      rawTranscript: c.rawTranscript,
      position: c.position,
      context: c.context,
      sourceId: c.sourceId,
    },
    expected: {
      tyler_answer: c.tyler_answer,
      expect: c.expect,
      category: c.category,
      question: c.question,
      source: c.source,
    },
    metadata: {
      id: c.id,
      source: c.source,
      category: c.category,
      essayId: c.essayId,
      essayTitle: c.essayTitle,
      promptIndex: c.promptIndex,
      hasTylerAnswer: c.tyler_answer != null,
      notes: c.notes,
    },
    tags: [c.source, c.category, c.tyler_answer ? "has_reference" : "needs_reference"],
  }));
}

module.exports = {
  ESSAYS_FIXTURE,
  CASES_JSONL,
  loadEssaysFixture,
  loadCases,
  normalizeCase,
  toEvalRows,
  inferLegacyCategory,
};
