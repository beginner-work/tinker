/* Keep crafting must always surface the next question (or a clear retry). */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const writing = fs.readFileSync(path.join(root, "src/renderer/writing.js"), "utf8");
const you = fs.readFileSync(path.join(root, "src/renderer/messages-you.js"), "utf8");

test("Keep crafting ignores premature model stitch and requires a next_question", () => {
  // forceStitch is the only stitch path; Keep crafting refuses empty next_question.
  assert.match(writing, /if \(forceStitch\)/);
  assert.match(writing, /renderNextQuestionRetry/);
  assert.match(writing, /The next question came back empty/);
  assert.equal(/parsed\.done && parsed\.stitched_body/.test(writing), false);
  assert.match(writing, /const q = String\(parsed\.next_question \|\| ""\)\.trim\(\)/);
  assert.match(writing, /if \(!q\) \{\s*renderNextQuestionRetry/);
});

test("empty Keep crafting nudges instead of silent no-op", () => {
  assert.match(writing, /nudgeEmptyAnswer/);
  assert.match(writing, /Type an answer first/);
  assert.match(writing, /writing-input--needs-answer/);
});

test("failed or empty next question keeps Keep crafting wired as retry", () => {
  assert.match(writing, /function wireKeepCraftingRetry/);
  assert.match(writing, /wireKeepCraftingRetry\(\)/);
  assert.match(writing, /Asking the next question/);
});

test("You chrome labels interview Next as Keep crafting, not Continue", () => {
  assert.match(you, /Keep crafting/);
  assert.match(you, /Continue →/);
  assert.match(you, /label === "Continue/);
});
