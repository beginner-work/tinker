/* Reconstruct desktop exercise from technical essay (mocked Opus 5.5). */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reconstruct = require("../src/renderer/lib/exercise-reconstruct.js");
const progress = require("../src/renderer/lib/learning-progress.js");
const models = require("../src/renderer/lib/claude-models.js");
const structured = require("../src/renderer/lib/claude-structured.js");
const serverReconstruct = require("../api/_lib/exercise-reconstruct.js");

const html = fs.readFileSync(
  path.join(root, "src/renderer/repo/index.html"),
  "utf8"
);
const page = fs.readFileSync(
  path.join(root, "src/renderer/repo/repo.js"),
  "utf8"
);
const apiSrc = fs.readFileSync(
  path.join(root, "api/learning-reconstruct.js"),
  "utf8"
);

const longEssay =
  "I sketched PaymentIntent ask/return in plain English, then named " +
  "GET /payment_intents/{id} and the 200 shape. Still fuzzy on errors.";

const goodPayload = {
  nextPrompt: "Add the 404 error response for GET /payment_intents/{id}.",
  level: 28,
  practicePath: "01-smallest-valid-spec/api.md",
  fileName: "api.md",
  startingPracticeFile: "# PaymentIntent\n\nTODO: add 404\n",
  zpd: {
    unaided: "Named a GET path.",
    justBeyond: "Error responses.",
  },
};

test("reconstruct pins Opus 5.5", () => {
  assert.equal(models.EXERCISE_REFACTOR, "claude-opus-5-5");
  assert.equal(reconstruct.MODEL, models.EXERCISE_REFACTOR);
});

test("revisionKey is stable and changes with body", () => {
  const a = reconstruct.revisionKey("e1", "hello", 1);
  const b = reconstruct.revisionKey("e1", "hello", 1);
  const c = reconstruct.revisionKey("e1", "hello!", 1);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(reconstruct.alreadyReconstructed({ essayReconstructKey: a }, a), true);
  assert.equal(reconstruct.alreadyReconstructed({ essayReconstructKey: a }, c), false);
});

test("reconstructFromEssay uses mocked callFn", async () => {
  let sawModel = null;
  const result = await reconstruct.reconstructFromEssay({
    essayBody: longEssay,
    progress: progress.defaultProgress(),
    structuredApi: structured,
    callFn: async (payload) => {
      sawModel = payload.model;
      return {
        text: "",
        toolUse: {
          name: "submit_exercise_reconstruct",
          input: goodPayload,
        },
      };
    },
  });
  assert.equal(sawModel, "claude-opus-5-5");
  assert.equal(result.value.level, 28);
  assert.match(result.value.nextPrompt, /404/);
  assert.equal(result.calibration.level, 28);
  assert.match(result.calibration.startingPracticeFile, /TODO: add 404/);
});

test("validatePayload rejects formation and em dashes", () => {
  assert.throws(() =>
    reconstruct.validatePayload({
      ...goodPayload,
      nextPrompt: "Use Formation next.",
    })
  );
  assert.throws(() =>
    reconstruct.validatePayload({
      ...goodPayload,
      nextPrompt: "Do this — now.",
    })
  );
});

test("applyCalibration keeps goal while updating prompt/level/path", () => {
  const base = progress.defaultProgress();
  const next = progress.applyCalibration(base, {
    nextPrompt: goodPayload.nextPrompt,
    level: 28,
    practicePath: goodPayload.practicePath,
    fileName: goodPayload.fileName,
    zpd: goodPayload.zpd,
  });
  assert.equal(next.goalId, base.goalId);
  assert.equal(next.goalTitle, base.goalTitle);
  assert.equal(next.level, 28);
  assert.equal(next.practicePath, goodPayload.practicePath);
  assert.match(next.currentPrompt, /404/);
});

test("server reconstruct module exports idempotent runner", () => {
  const key = reconstruct.revisionKey("essay_1", longEssay, 99);
  assert.equal(typeof serverReconstruct.reconstructLearningFromEssay, "function");
  assert.equal(serverReconstruct.KIND, "learning_progress");
  assert.equal(reconstruct.alreadyReconstructed({ essayReconstructKey: key }, key), true);
  assert.equal(
    reconstruct.alreadyReconstructed({ essayReconstructKey: key }, key + "x"),
    false
  );
});

test("write page restores learning loop chrome without Exercises nav", () => {
  assert.match(html, /id="repo-learning-prompt"/);
  assert.match(html, /id="repo-code"/);
  assert.match(html, /id="repo-code-thats-everything"/);
  assert.match(html, /That's everything/);
  assert.match(html, /exercise-workspace-ui\.js/);
  assert.match(html, /learning-progress\.js/);
  assert.match(html, /exercise-reconstruct\.js/);
  assert.match(html, /repo-layout--learning/);
  assert.match(html, /aria-label="Technical essays"/);
  assert.match(html, /aria-label="Business essays"/);
  // Exercises explorer stays in DOM for id stability but is hidden; no nav entry.
  assert.match(html, /id="repo-explorer"[^>]*hidden/);
  assert.doesNotMatch(html, /data-exercises-nav/);
  assert.match(page, /scheduleLearningReconstruct/);
  assert.match(page, /tinkerExerciseWorkspaceUi/);
  assert.match(page, /\/api\/learning-reconstruct/);
  assert.match(apiSrc, /reconstructLearningFromEssay/);
  assert.doesNotMatch(apiSrc, /openai|codex|gpt-/i);
  assert.doesNotMatch(page, /openai|codex|gpt-/i);
});
