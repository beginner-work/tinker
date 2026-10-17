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

test("default progress seeds OpenAPI-from-scratch goal and plain-English prompt", () => {
  const d = progress.defaultProgress();
  assert.equal(d.goalId, "openapi-from-scratch");
  assert.match(d.goalTitle, /OpenAPI/);
  assert.match(d.currentPrompt, /plain English|PaymentIntent/i);
  assert.equal(d.level, 0);
  assert.equal(d.status, "active");
  assert.equal(d.practicePath, "00-in-plain-english/api.md");
  assert.doesNotMatch(d.currentPrompt, /where do you start/i);
  assert.doesNotMatch(JSON.stringify(d), /formation/i);
  assert.doesNotMatch(d.currentPrompt, /\u2014/);
});

test("applyCalibration updates prompt, ZPD, level, and goal done", () => {
  const next = progress.applyCalibration(progress.defaultProgress(), {
    nextPrompt: "Add GET /payment_intents/{id} with a 200 response.",
    level: 22,
    zpd: {
      unaided: "Named ask and return.",
      justBeyond: "First OpenAPI path.",
    },
    goalAchieved: false,
  });
  assert.match(next.currentPrompt, /GET \/payment_intents/);
  assert.equal(next.level, 22);
  assert.match(next.zpd.unaided, /ask/);
  assert.match(next.zpd.justBeyond, /OpenAPI/);
  assert.equal(next.status, "active");

  const done = progress.applyCalibration(next, {
    nextPrompt: "Goal complete.",
    level: 100,
    goalAchieved: true,
    zpd: { unaided: "Full contract.", justBeyond: "" },
  });
  assert.equal(done.status, "done");
  assert.equal(done.level, 100);
});

test("startNextGoal resets level and keeps exercise home", () => {
  const done = progress.applyCalibration(progress.defaultProgress(), {
    goalAchieved: true,
    level: 100,
    nextPrompt: "Done.",
  });
  const next = progress.startNextGoal(done, {
    goalTitle: "Write a webhook receiver by feel",
    currentPrompt: "Sketch the event names you will accept.",
  });
  assert.equal(next.status, "active");
  assert.equal(next.level, 0);
  assert.match(next.goalTitle, /webhook/);
  assert.equal(next.exerciseId, "api-design");
});

test("API and UI wire learning_progress through existing Prisma store", () => {
  assert.match(apiSrc, /makeHandler\("learning_progress"\)/);
  assert.equal(progress.KIND, "learning_progress");
  assert.doesNotMatch(html, /learning-progress\.js/);
  assert.match(ui, /\/api\/user-data\/learning-progress/);
  assert.match(ui, /persistLearningProgress|loadLearningProgress/);
  assert.doesNotMatch(ui, /openai|codex|gpt-/i);
});
