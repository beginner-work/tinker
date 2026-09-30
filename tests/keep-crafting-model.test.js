"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { KEEP_CRAFTING_MODEL } = require("../api/_lib/keep-crafting-model.js");

test("KEEP_CRAFTING_MODEL defaults to Opus until a Google cutover is confirmed", () => {
  assert.equal(KEEP_CRAFTING_MODEL, "claude-opus-4-8");
});
