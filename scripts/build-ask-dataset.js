#!/usr/bin/env node
/* Build evals/ask/dataset/cases.jsonl from essay fixtures + synthetic cases.
 *
 * Usage:
 *   node scripts/build-ask-dataset.js
 *
 * Reads:
 *   evals/ask/fixtures/essays.json
 *   evals/ask/dataset/synthetic/*.json
 *   evals/ask/dataset/visitor/*.json   (optional promotions)
 * Writes:
 *   evals/ask/dataset/cases.jsonl
 *   evals/ask/dataset/summary.json
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  pairsFromEssay,
  summarizePairs,
} = require("../evals/ask/lib/extract-pairs.js");
const { normalizeCase } = require("../evals/ask/lib/load-dataset.js");

const ROOT = path.join(__dirname, "..", "evals", "ask");
const FIXTURE = path.join(ROOT, "fixtures", "essays.json");
const OUT_JSONL = path.join(ROOT, "dataset", "cases.jsonl");
const OUT_SUMMARY = path.join(ROOT, "dataset", "summary.json");
const SYN_DIR = path.join(ROOT, "dataset", "synthetic");
const VIS_DIR = path.join(ROOT, "dataset", "visitor");

function loadJsonDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")));
}

function main() {
  let essays = [];
  if (fs.existsSync(FIXTURE)) {
    const raw = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
    essays = Array.isArray(raw) ? raw : raw.essays || [];
  }

  const essayPairs = [];
  for (const essay of essays) {
    essayPairs.push(...pairsFromEssay(essay));
  }

  const synthetic = loadJsonDir(SYN_DIR).map((c) => ({
    ...c,
    source: c.source || "synthetic",
    tyler_answer: c.tyler_answer != null ? c.tyler_answer : null,
  }));
  const visitor = loadJsonDir(VIS_DIR).map((c) => ({
    ...c,
    source: "visitor",
    tyler_answer: c.tyler_answer != null ? c.tyler_answer : null,
  }));

  const all = [...essayPairs, ...synthetic, ...visitor]
    .map(normalizeCase)
    .filter(Boolean);

  const byId = new Map();
  for (const c of all) byId.set(c.id, c);
  const rows = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));

  fs.mkdirSync(path.dirname(OUT_JSONL), { recursive: true });
  fs.writeFileSync(OUT_JSONL, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const summary = {
    builtAt: new Date().toISOString(),
    essayFixtureCount: essays.length,
    ...summarizePairs(rows),
    withTylerAnswer: rows.filter((r) => r.tyler_answer != null).length,
    needsTylerAnswer: rows.filter((r) => r.tyler_answer == null).length,
  };
  fs.writeFileSync(OUT_SUMMARY, JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
}

main();
