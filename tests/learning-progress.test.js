/* Per-user ZPD learning progress (TinkerUserData kind learning_progress). */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const progress = require("../src/renderer/lib/learning-progress.js");
const apiSrc = fs.readFileSync(
  path.join(root, "api/user-data/learning-progress.js"),
  "utf8"
);
const html = fs.readFileSync(
  path.join(root, "src/renderer/repo/index.html"),
  "utf8"
);
const ui = fs.readFileSync(
  path.join(root, "src/renderer/repo/exercise-workspace-ui.js"),
  "utf8"
);

test("default progress is awaiting a technical essay (no seeded curriculum)", () => {
  const d = progress.defaultProgress();
  assert.equal(d.status, "awaiting_essay");
  assert.equal(d.goalId, "");
  assert.equal(d.goalTitle, "");
  assert.equal(d.currentPrompt, "");
  assert.equal(d.practicePath, "");
  assert.equal(d.level, 0);
  assert.equal(d.exerciseId, "from-essays");
  assert.equal(progress.hasExercise(d), false);
  assert.match(progress.EMPTY_COPY, /Write a technical essay/);
  assert.doesNotMatch(JSON.stringify(d), /formation|openapi-from-scratch|PaymentIntent/i);
});

test("applyCalibration activates goal from essay-derived reconstruct", () => {
  const next = progress.applyCalibration(progress.defaultProgress(), {
    sourceEssayId: "e1",
    sourceEssayTitle: "Payment intents",
    goalId: "openapi-errors",
    goalTitle: "Name error responses",
    nextPrompt: "Add GET /payment_intents/{id} with a 200 response.",
    level: 22,
    practicePath: "payment-intent/api.md",
    fileName: "api.md",
    zpd: {
      unaided: "Named ask and return.",
      justBeyond: "First OpenAPI path.",
    },
    goalAchieved: false,
  });
  assert.equal(next.status, "active");
  assert.equal(next.sourceEssayId, "e1");
  assert.equal(next.sourceEssayTitle, "Payment intents");
  assert.match(next.goalTitle, /error responses/i);
  assert.match(next.currentPrompt, /GET \/payment_intents/);
  assert.equal(next.level, 22);
  assert.equal(progress.hasExercise(next), true);

  const done = progress.applyCalibration(next, {
    nextPrompt: "Goal complete.",
    level: 100,
    goalAchieved: true,
    zpd: { unaided: "Full contract.", justBeyond: "" },
  });
  assert.equal(done.status, "done");
  assert.equal(done.level, 100);
});

test("startNextGoal can reset to awaiting essay", () => {
  const done = progress.applyCalibration(progress.defaultProgress(), {
    sourceEssayId: "e1",
    sourceEssayTitle: "Hooks",
    goalId: "hooks",
    goalTitle: "Webhook receiver",
    goalAchieved: true,
    level: 100,
    nextPrompt: "Done.",
    practicePath: "hooks/handler.ts",
  });
  const next = progress.startNextGoal(done, {
    goalTitle: "",
    currentPrompt: "",
  });
  assert.equal(next.status, "awaiting_essay");
  assert.equal(next.level, 0);
  assert.equal(next.exerciseId, "from-essays");
});

test("API and UI wire learning_progress through existing Prisma store", () => {
  assert.match(apiSrc, /makeHandler\("learning_progress"\)/);
  assert.equal(progress.KIND, "learning_progress");
  assert.match(html, /learning-progress\.js/);
  assert.match(html, /repo-learning-empty/);
  assert.match(ui, /\/api\/user-data\/learning-progress/);
  assert.match(ui, /persistLearningProgress|loadLearningProgress/);
  assert.match(ui, /isAwaitingEssay|EMPTY_COPY/);
  assert.doesNotMatch(ui, /openai|codex|gpt-/i);
});
