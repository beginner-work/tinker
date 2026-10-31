"use strict";

const fs = require("node:fs");
const path = require("node:path");

const CASES_PATH = path.join(__dirname, "..", "cases", "cases.json");
const KEY_PATH = path.join(__dirname, "..", "cases", "key.json");

function loadCases() {
  const doc = JSON.parse(fs.readFileSync(CASES_PATH, "utf8"));
  if (!doc.internal) {
    throw new Error("source-zpd cases must be marked internal: true");
  }
  return doc.cases || [];
}

function loadKey() {
  const doc = JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));
  if (!doc.internal) {
    throw new Error("source-zpd key must be marked internal: true");
  }
  return doc.keys || {};
}

function loadCasesWithKey() {
  const cases = loadCases();
  const keys = loadKey();
  return cases.map((c) => ({
    ...c,
    inBandSourceIds: keys[c.id] || [],
  }));
}

module.exports = {
  CASES_PATH,
  KEY_PATH,
  loadCases,
  loadKey,
  loadCasesWithKey,
};
