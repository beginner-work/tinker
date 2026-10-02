/* Read CACHE_VERSION from src/renderer/sw.js for tests.
 *
 * Do not hardcode tinker-shell-vNN in satellite tests (#391 #393 #394).
 * Format + value assertions live only in tests/offline-shell.test.js.
 * Other tests may import swSource when they need the file bytes.
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

/** Current CACHE_VERSION string from sw.js (e.g. tinker-shell-v26). */
const EXPECTED_SW_CACHE_VERSION = match[1];

module.exports = {
  EXPECTED_SW_CACHE_VERSION,
  swSource: sw,
};
