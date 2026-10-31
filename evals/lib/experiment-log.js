"use strict";

const fs = require("node:fs");
const path = require("node:path");

const LOG_DIR = path.join(__dirname, "..", "experiment-log");
const LOG_PATH = path.join(LOG_DIR, "experiments.jsonl");
const TEST_COUNT_PATH = path.join(LOG_DIR, "test-eval-count.json");

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function readTestEvalCount() {
  try {
    const doc = JSON.parse(fs.readFileSync(TEST_COUNT_PATH, "utf8"));
    return Number(doc.count) || 0;
  } catch {
    return 0;
  }
}

function writeTestEvalCount(count) {
  ensureLogDir();
  fs.writeFileSync(
    TEST_COUNT_PATH,
    JSON.stringify(
      {
        count,
        updatedAt: new Date().toISOString(),
        note: "Incremented only when a held-out test split is evaluated.",
      },
      null,
      2,
    ) + "\n",
  );
}

/**
 * Append one experiment row.
 *
 * @param {object} entry
 * @param {string} entry.version config version
 * @param {string} entry.benchmark ednet-zpd | source-zpd | …
 * @param {'train'|'dev'|'test'} entry.split
 * @param {object} entry.devScore scores from the iteration-facing split (usually dev)
 * @param {object|null} [entry.testScore] only when split==='test'
 * @param {object} [entry.meta]
 * @param {boolean} [entry.dryRun] if true, do not write
 */
function appendExperiment(entry) {
  if (entry && entry.dryRun) {
    return { wrote: false, testEvalCount: readTestEvalCount(), entry };
  }
  ensureLogDir();
  let testEvalCount = readTestEvalCount();
  if (entry.split === "test") {
    testEvalCount += 1;
    writeTestEvalCount(testEvalCount);
  }

  const row = {
    at: new Date().toISOString(),
    version: entry.version,
    benchmark: entry.benchmark,
    split: entry.split,
    devScore: entry.devScore != null ? entry.devScore : null,
    testScore: entry.split === "test" ? entry.testScore || entry.devScore : null,
    testEvalCount,
    meta: entry.meta || {},
  };
  fs.appendFileSync(LOG_PATH, JSON.stringify(row) + "\n");
  return { wrote: true, testEvalCount, entry: row };
}

function readExperiments() {
  if (!fs.existsSync(LOG_PATH)) return [];
  return fs
    .readFileSync(LOG_PATH, "utf8")
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

module.exports = {
  LOG_DIR,
  LOG_PATH,
  TEST_COUNT_PATH,
  readTestEvalCount,
  writeTestEvalCount,
  appendExperiment,
  readExperiments,
};
