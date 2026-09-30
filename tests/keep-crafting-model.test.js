"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { KEEP_CRAFTING_MODEL } = require("../api/_lib/keep-crafting-model.js");

test("KEEP_CRAFTING_MODEL defaults to Opus (on-device Gemma E2B falls back here)", () => {
  assert.equal(KEEP_CRAFTING_MODEL, "claude-opus-4-8");
});

test("keep-crafting-model docs name the on-device iOS PWA fallback", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const src = fs.readFileSync(
    path.join(__dirname, "../api/_lib/keep-crafting-model.js"),
    "utf8"
  );
  assert.match(src, /on-device/);
  assert.match(src, /2965/);
  assert.match(src, /fallback/i);
});
