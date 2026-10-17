/* Reconstruct desktop exercise from technical essays (mocked Opus 5.5). */
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

const essayA = {
  id: "e_payments",
  title: "Payment intents by feel",
  body:
    "I sketched PaymentIntent ask/return in plain English, then named " +
    "GET /payment_intents/{id} and the 200 shape. Still fuzzy on errors.",
};
const essayB = {
  id: "e_hooks",
  title: "Webhook retry shape",
  body:
    "Webhooks need idempotent handlers. I wrote a retry table but not the " +
    "signature check yet.",
};

const goodPayload = {
  sourceEssayId: "e_payments",
  goalId: "openapi-errors",
  goalTitle: "Name error responses for PaymentIntent reads",
  nextPrompt: "Add the 404 error response for GET /payment_intents/{id}.",
  level: 28,
  practicePath: "payment-intent/api.md",
  fileName: "api.md",
  startingPracticeFile:
    "# Payment Intent\n\n## GET /payment_intents/{id}\n\n### 200\n\nid: string\n",
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

test("reconstructFromTechnicalEssays uses mocked callFn and picks source essay", async () => {
  let sawModel = null;
  let sawUser = "";
  const result = await reconstruct.reconstructFromTechnicalEssays({
    essays: [essayA, essayB],
    progress: progress.defaultProgress(),
    structuredApi: structured,
    callFn: async (payload) => {
      sawModel = payload.model;
      sawUser = JSON.stringify(payload.messages || []);
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
  assert.match(sawUser, /e_payments/);
  assert.match(sawUser, /e_hooks/);
  assert.equal(result.value.sourceEssayId, "e_payments");
  assert.equal(result.value.level, 28);
  assert.match(result.value.nextPrompt, /404/);
  assert.equal(result.calibration.sourceEssayTitle, "Payment intents by feel");
  assert.match(result.calibration.startingPracticeFile, /Payment Intent/);
  assert.doesNotMatch(result.calibration.startingPracticeFile, /TODO/);
});

test("validatePayload rejects scaffolds, formation, and unknown essay ids", () => {
  assert.throws(() =>
    reconstruct.validatePayload(
      { ...goodPayload, nextPrompt: "Use Formation next." },
      [essayA, essayB]
    )
  );
  assert.throws(() =>
    reconstruct.validatePayload(
      { ...goodPayload, nextPrompt: "Do this — now." },
      [essayA, essayB]
    )
  );
  assert.throws(() =>
    reconstruct.validatePayload(
      {
        ...goodPayload,
        startingPracticeFile:
          "<!-- Document the payments API contract from a caller's perspective. -->\n",
      },
      [essayA, essayB]
    )
  );
  assert.throws(() =>
    reconstruct.validatePayload(
      { ...goodPayload, sourceEssayId: "missing" },
      [essayA, essayB]
    )
  );
});

test("applyCalibration updates goal from essay-derived reconstruct", () => {
  const base = progress.defaultProgress();
  assert.equal(base.status, "awaiting_essay");
  const next = progress.applyCalibration(base, {
    sourceEssayId: goodPayload.sourceEssayId,
    sourceEssayTitle: essayA.title,
    goalId: goodPayload.goalId,
    goalTitle: goodPayload.goalTitle,
    nextPrompt: goodPayload.nextPrompt,
    level: 28,
    practicePath: goodPayload.practicePath,
    fileName: goodPayload.fileName,
    zpd: goodPayload.zpd,
  });
  assert.equal(next.status, "active");
  assert.equal(next.goalId, goodPayload.goalId);
  assert.equal(next.goalTitle, goodPayload.goalTitle);
  assert.equal(next.sourceEssayId, "e_payments");
  assert.equal(next.sourceEssayTitle, essayA.title);
  assert.equal(next.level, 28);
  assert.match(next.currentPrompt, /404/);
});

test("server reconstruct module exports idempotent runner", () => {
  const key = reconstruct.revisionKey("essay_1", essayA.body, 99);
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
  assert.match(html, /id="repo-learning-empty"/);
  assert.match(html, /id="repo-learning-source"/);
  assert.match(html, /Write a technical essay to get your first coding exercise/);
  assert.match(html, /id="repo-code"/);
  assert.match(html, /id="repo-code-thats-everything"/);
  assert.match(html, /That's everything/);
  assert.match(html, /exercise-workspace-ui\.js/);
  assert.match(html, /learning-progress\.js/);
  assert.match(html, /exercise-reconstruct\.js/);
  assert.match(html, /repo-layout--learning/);
  assert.match(html, /aria-label="Technical essays"/);
  assert.match(html, /aria-label="Business essays"/);
  assert.match(html, /id="repo-explorer"[^>]*hidden/);
  assert.doesNotMatch(html, /data-exercises-nav/);
  assert.match(page, /scheduleLearningReconstruct/);
  assert.match(page, /technicalEssaysPayload/);
  assert.match(page, /tinkerExerciseWorkspaceUi/);
  assert.match(page, /\/api\/learning-reconstruct/);
  assert.match(apiSrc, /reconstructLearningFromEssay/);
  assert.doesNotMatch(apiSrc, /openai|codex|gpt-/i);
  assert.doesNotMatch(page, /openai|codex|gpt-/i);
});
