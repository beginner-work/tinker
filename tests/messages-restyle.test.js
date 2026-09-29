/* TYL-65 slice 4: /leads shares messaging visual language. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "src/renderer/leads/index.html"), "utf8");

test("leads page drops nested cards for hairline sections", () => {
  assert.match(html, /no card-in-card/);
  assert.match(html, /border-top:\s*1px solid var\(--color-border\)/);
  assert.match(html, /Draft messages live in Messages/);
  assert.match(html, /href="\/"/);
  assert.equal(/background:\s*var\(--color-card\)/.test(html), false);
  assert.equal(/border-radius:\s*var\(--radius-card\)/.test(html), false);
  assert.equal(/\bTyler\b/.test(html), false);
});

test("schedule restyle skipped while TYL-64 stack is parallel", () => {
  const scheduleDir = path.join(__dirname, "..", "src/renderer/schedule");
  assert.equal(fs.existsSync(scheduleDir), false);
});
