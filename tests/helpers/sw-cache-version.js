/* Single source of truth for the SW CACHE_VERSION pin in tests.
 *
 * Read the live value from src/renderer/sw.js so a bump only needs to
 * change sw.js + this expected pin when the strategy/precache list
 * changes. Satellite tests import EXPECTED_SW_CACHE_VERSION instead of
 * hardcoding tinker-shell-vNN in five places (those drifts were a
 * recurring CI failure on otherwise-good PRs).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const swPath = path.join(__dirname, "..", "..", "src", "renderer", "sw.js");
const sw = fs.readFileSync(swPath, "utf8");
const match = sw.match(/CACHE_VERSION\s*=\s*["'](tinker-shell-v\d+)["']/);

if (!match) {
  throw new Error("CACHE_VERSION missing or malformed in src/renderer/sw.js");
}

/** Current CACHE_VERSION string from sw.js (e.g. tinker-shell-v18). */
const EXPECTED_SW_CACHE_VERSION = match[1];

module.exports = {
  EXPECTED_SW_CACHE_VERSION,
  swSource: sw,
};
