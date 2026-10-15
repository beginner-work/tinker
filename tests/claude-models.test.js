/* Central Anthropic model ids + exercise refactor helpers. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const models = require("../src/renderer/lib/claude-models.js");
const refactor = require("../src/renderer/lib/exercise-refactor.js");
const evaluate = require("../src/renderer/lib/exercise-evaluate.js");
const interview = require("../src/renderer/interview-prompt.js");
const cmSrc = fs.readFileSync(
  path.join(root, "src/renderer/lib/repo-cm-editor-src.mjs"),
  "utf8"
);
const ui = fs.readFileSync(
  path.join(root, "src/renderer/repo/exercise-workspace-ui.js"),
  "utf8"
);
const html = fs.readFileSync(
  path.join(root, "src/renderer/repo/index.html"),
  "utf8"
);
const writing = fs.readFileSync(
  path.join(root, "src/renderer/writing.js"),
  "utf8"
);
const indexHtml = fs.readFileSync(
  path.join(root, "src/renderer/index.html"),
  "utf8"
);

test("claude-models pins writing Haiku 4.5 and exercise refactor Opus 5.5", () => {
  assert.equal(models.WRITING, "claude-haiku-4-5-20251001");
  assert.equal(models.KEEP_CRAFTING, models.WRITING);
  assert.equal(models.EXERCISE_REFACTOR, "claude-opus-5-5");
  assert.equal(interview.KEEP_CRAFTING_MODEL, models.WRITING);
  assert.equal(refactor.MODEL, models.EXERCISE_REFACTOR);
  assert.equal(evaluate.MODEL, models.EXERCISE_REFACTOR);
});

test("writing UI and interview load the shared models config", () => {
  assert.match(indexHtml, /claude-models\.js/);
  assert.match(html, /claude-models\.js/);
  assert.match(html, /exercise-refactor\.js/);
  assert.match(html, /exercise-evaluate\.js/);
  assert.match(writing, /tinkerClaudeModels|KEEP_CRAFTING_MODEL/);
  assert.doesNotMatch(writing, /model:\s*["']claude-opus-4-8["']/);
});

test("exercise editor exposes refactor chrome and selection helpers", () => {
  assert.match(html, /id="repo-code-refactor"/);
  assert.match(html, /id="repo-code-refactor-accept"/);
  assert.match(html, /id="repo-code-refactor-reject"/);
  assert.match(ui, /askRefactor|acceptRefactor|rejectRefactor/);
  assert.match(ui, /EXERCISE_REFACTOR|refactorApi\.MODEL/);
  assert.match(ui, /selectionForRefactor|replaceEditorRange/);
  assert.match(cmSrc, /view\.state\.selection|getSelection/);
});

test("exercise refactor parses JSON and applies a range replacement", () => {
  const parsed = refactor.parseRefactorReply(
    '```json\n{"replacement":"new step","summary":"Renamed step"}\n```'
  );
  assert.equal(parsed.replacement, "new step");
  assert.equal(parsed.summary, "Renamed step");
  assert.equal(
    refactor.applyReplacement("aaaBBBccc", 3, 6, "YYY"),
    "aaaYYYccc"
  );
  const user = refactor.buildRefactorUserMessage({
    fileName: "README.md",
    instruction: "Make this step about PaymentIntent",
    selectedText: "1. Old step",
  });
  assert.match(user, /PaymentIntent/);
  assert.match(user, /<<<SELECTION/);
});
