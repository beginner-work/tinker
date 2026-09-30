/* Keep crafting must always surface the next question (never an empty/done error). */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const writing = fs.readFileSync(path.join(root, "src/renderer/writing.js"), "utf8");
const you = fs.readFileSync(path.join(root, "src/renderer/messages-you.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");

test("Keep crafting passes keepCrafting and never stitches on that path", () => {
  assert.match(writing, /askNext\(\{ keepCrafting: true \}\)/);
  assert.match(writing, /async function askNext\(\{ forceStitch = false, keepCrafting = false \}/);
  assert.match(writing, /keepCrafting && attempt > 0/);
  assert.match(writing, /fallbackKeepCraftingQuestion/);
  assert.match(writing, /normalizeKeepCraftingQuestion/);
  assert.equal(/parsed\.done && parsed\.stitched_body/.test(writing), false);
  assert.equal(/The next question came back empty/.test(writing), false);
  assert.equal(/renderNextQuestionRetry/.test(writing), false);
  assert.match(writing, /renderPublishRecovery/);
});

test("empty Keep crafting nudges instead of silent no-op", () => {
  assert.match(writing, /nudgeEmptyAnswer/);
  assert.match(writing, /Type an answer first/);
  assert.match(writing, /writing-input--needs-answer/);
});

test("failed Keep crafting keeps retry wired; error card is for network only", () => {
  assert.match(writing, /function wireKeepCraftingRetry/);
  assert.match(writing, /wireKeepCraftingRetry\(\)/);
  assert.match(writing, /Asking the next question/);
  assert.match(writing, /Couldn't reach Claude/);
  assert.match(writing, /Real network\/server failure/);
});

test("You chrome labels interview Next as Keep crafting, not Continue", () => {
  assert.match(you, /Keep crafting/);
  assert.match(you, /Continue →/);
  assert.match(you, /label === "Continue/);
  // History paging must stay "Next →" — renaming it made Keep crafting a no-op.
  assert.match(you, /Next →/);
  assert.match(you, /label === "Next/);
});

test("Keep crafting rejects repeat next_question and asks unused fallback", () => {
  assert.match(writing, /askedForKeepCrafting/);
  assert.match(writing, /normalizeKeepCraftingQuestion\(parsed, asked\)/);
  assert.match(writing, /fallbackKeepCraftingQuestion\(turns, askedNow\)/);
  assert.match(writing, /askNext\(\{ keepCrafting: true \}\)/);
  assert.match(writing, /atEnd && youMode/);
});

test("error card contrast is strong in You mode and base styles", () => {
  assert.match(css, /\.writing-card--error \.writing-error/);
  assert.match(css, /color: #5c2410/);
  assert.match(
    css,
    /body\.messages-you-active[\s\S]*writing-card--error[\s\S]*writing-error[\s\S]*#5c2410/
  );
});
