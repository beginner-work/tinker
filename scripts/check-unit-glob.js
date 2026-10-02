#!/usr/bin/env node
/* Keep Playwright E2E files out of the unit test glob.
 *
 * CI runs `node --test tests/*.test.js`. E2E specs must be named
 * `tests/*.e2e.js` (see AGENTS.md). This fails if any unit test imports
 * Playwright (#360).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const testsDir = path.join(__dirname, "..", "tests");
const bad = [];

for (const name of fs.readdirSync(testsDir)) {
  if (!name.endsWith(".test.js")) continue;
  const rel = path.join("tests", name);
  const text = fs.readFileSync(path.join(testsDir, name), "utf8");
  if (/require\s*\(\s*["']playwright["']\s*\)|from\s+["']playwright["']/.test(text)) {
    bad.push(`${rel}: imports playwright (rename to *.e2e.js or drop the import)`);
  }
}

if (bad.length) {
  console.error("Unit glob must not load Playwright:");
  for (const hit of bad) console.error(`  ${hit}`);
  process.exit(1);
}

console.log("check-unit-glob: ok");
