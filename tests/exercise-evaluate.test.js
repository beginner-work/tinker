/* That's everything: evaluate answer + next-step README adapt. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const models = require("../src/renderer/lib/claude-models.js");
const evaluate = require("../src/renderer/lib/exercise-evaluate.js");
const revision = require("../src/renderer/lib/exercise-revision.js");
const core = require("../src/renderer/lib/exercise-workspace-core.js");
const seed = require("../src/renderer/lib/exercise-workspace-seed.json");
const manifest = require("../src/renderer/exercises/manifest.js");

const ui = fs.readFileSync(
  path.join(root, "src/renderer/repo/exercise-workspace-ui.js"),
  "utf8"
);
const html = fs.readFileSync(
  path.join(root, "src/renderer/repo/index.html"),
  "utf8"
);
const css = fs.readFileSync(
  path.join(root, "src/renderer/repo/repo.css"),
  "utf8"
);
const evaluateSrc = fs.readFileSync(
  path.join(root, "src/renderer/lib/exercise-evaluate.js"),
  "utf8"
);

test("That's everything uses the exercise Opus model id", () => {
  assert.equal(models.EXERCISE_REFACTOR, "claude-opus-5-5");
  assert.equal(evaluate.MODEL, models.EXERCISE_REFACTOR);
  assert.match(evaluateSrc, /EXERCISE_REFACTOR/);
  assert.doesNotMatch(evaluateSrc, /openai|codex|gpt-/i);
  // Write page loads exercise-evaluate for the desktop learning loop.
  assert.match(html, /exercise-evaluate\.js/);
  assert.match(ui, /tinkerExerciseEvaluate|evaluateApi/);
  assert.match(ui, /runThatsEverything/);
  assert.match(ui, /applyRevisedContent|applyNextStepReadme/);
  assert.match(ui, /persistLearningProgress|learning-progress/);
});

test("exercise editor That's everything chrome lives on write page learning loop", () => {
  assert.match(html, /id="repo-code-thats-everything"/);
  assert.match(html, /id="repo-learning-prompt"/);
  assert.match(html, /learning-progress\.js/);
  assert.match(css, /repo-code__thats-everything/);
  assert.match(css, /repo-learning__prompt/);
  assert.match(css, /repo-surface__action--primary/);
  assert.match(ui, /persistMutation\([\s\S]*write_file/);
  assert.match(ui, /flashAppliedHighlight|is-just-applied/);
});

test("listSteps and findCurrentStep resolve api-design curriculum folders", () => {
  const workspace = core.buildSeedWorkspace(seed, manifest.modules || []);
  const ex = workspace.exercises["api-design"];
  assert.ok(ex);
  const stepsNode = revision.findNodeByPath(ex.nodes, "steps.json");
  assert.ok(stepsNode);
  const steps = evaluate.listSteps(stepsNode.content);
  assert.ok(steps.length >= 3);
  assert.equal(steps[0].folder, "00-in-plain-english");
  const found = evaluate.findCurrentStep(steps, "00-in-plain-english/api.md");
  assert.equal(found.index, 0);
  assert.equal(found.step.id, "00");
  const next = evaluate.nextStepAfter(steps, found.index);
  assert.equal(next.folder, "01-smallest-valid-spec");
  assert.equal(
    evaluate.readmePathForStep(next),
    "01-smallest-valid-spec/README.md"
  );
});

test("parseEvaluateReply reads feedback and next-step rewrite", () => {
  const parsed = evaluate.parseEvaluateReply(
    JSON.stringify({
      feedback: "You named PaymentIntent. Still missing capture under ask.",
      summary: "Finer next step for the gap on capture.",
      nextStepPath: "01-smallest-valid-spec/README.md",
      nextStepContent: "# 01\n\nDo one path only.\n",
      aggressiveness: { struggle: "hard", action: "finer" },
    })
  );
  assert.match(parsed.feedback, /PaymentIntent/);
  assert.equal(parsed.nextStepPath, "01-smallest-valid-spec/README.md");
  assert.match(parsed.nextStepContent, /Do one path only/);
  assert.equal(parsed.aggressiveness.struggle, "hard");
  assert.equal(parsed.aggressiveness.action, "finer");
});

test("parseEvaluateReply rejects Formation mentions and empty feedback", () => {
  assert.throws(
    () =>
      evaluate.parseEvaluateReply(
        JSON.stringify({
          feedback: "Go back to Formation curriculum.",
          nextStepPath: "01/README.md",
          nextStepContent: "x",
        })
      ),
    /Formation/
  );
  assert.throws(() => evaluate.parseEvaluateReply("{}"), /feedback/i);
});

test("buildEvaluateUserMessage includes goals and hidden dial reminder", () => {
  const msg = evaluate.buildEvaluateUserMessage({
    exerciseId: "api-design",
    exerciseName: "OpenAPI by hand",
    filePath: "00-in-plain-english/api.md",
    answerText: "## ask\nCaller can get one payment intent by id.\n",
    currentStep: {
      id: "00",
      folder: "00-in-plain-english",
      title: "In plain English",
      goal: "Answer ask/send/return/wrong.",
    },
    currentReadme: "# 00\n",
    nextStep: {
      id: "01",
      folder: "01-smallest-valid-spec",
      title: "Smallest valid spec",
      goal: "Smallest OpenAPI doc.",
    },
    nextReadme: "# 01\n",
  });
  assert.match(msg, /PaymentIntent|payment intent/i);
  assert.match(msg, /<<<ANSWER/);
  assert.match(msg, /aggressiveness dial/i);
  assert.match(msg, /Never mention Formation/);
  assert.throws(
    () =>
      evaluate.buildEvaluateUserMessage({
        answerText: "   ",
        currentStep: { folder: "00-in-plain-english" },
      }),
    /Write an answer/
  );
});

test("applyNextStepReadme persists through workspace write path without Formation", () => {
  const workspace = core.buildSeedWorkspace(seed, manifest.modules || []);
  const pathName = "01-smallest-valid-spec/README.md";
  const before = revision.findNodeByPath(
    workspace.exercises["api-design"].nodes,
    pathName
  );
  assert.ok(before);
  const nextContent =
    "# 01: Smallest valid spec\n\nDo only GET /payment_intents/{id}.\n";
  const applied = evaluate.applyNextStepReadme(workspace, {
    core: core,
    revision: revision,
    exerciseId: "api-design",
    nextStepPath: pathName,
    nextStepContent: nextContent,
    workspace: workspace,
  });
  assert.equal(applied.path, pathName);
  const after = revision.findNodeByPath(
    applied.workspace.exercises["api-design"].nodes,
    pathName
  );
  assert.equal(after.content, nextContent);
  assert.throws(
    () =>
      evaluate.applyNextStepReadme(workspace, {
        core: core,
        revision: revision,
        exerciseId: "api-design",
        nextStepPath: pathName,
        nextStepContent: "Back to Formation labs.",
        workspace: workspace,
      }),
    /Formation/
  );
});

test("prompt never offers a full solution and bans Formation", () => {
  assert.match(evaluate.SYSTEM_PROMPT, /Never dump a full finished solution|Never give a full solution/i);
  assert.match(evaluate.SYSTEM_PROMPT, /Never mention Formation/i);
  assert.match(evaluate.SYSTEM_PROMPT, /aggressiveness dial/i);
  assert.match(evaluate.SYSTEM_PROMPT, /finer/);
  assert.match(evaluate.SYSTEM_PROMPT, /skip_ahead|skip ahead|merge/i);
  assert.doesNotMatch(evaluateSrc, /formation-persistent-storage/i);
});

test("aggressiveness helpers map struggle to action defaults", () => {
  assert.equal(evaluate.normalizeStruggle("HARD"), "hard");
  assert.equal(evaluate.normalizeAction("", "hard"), "finer");
  assert.equal(evaluate.normalizeAction("", "easy"), "skip_ahead");
  assert.equal(evaluate.normalizeAction("keep", "hard"), "keep");
});

test("That's everything grades practice answer even when lesson README is open", () => {
  // Module sidebar opens README on step click; evaluate must not send that
  // lesson text as Tyler's answer.
  assert.match(ui, /openIsLesson/);
  assert.match(ui, /answerNodeForStep/);
  assert.match(ui, /answerNodeId/);
  assert.match(ui, /evaluateMaxTokens/);
  assert.match(ui, /32000/);
  assert.match(ui, /effort:\s*["']low["']/);
});
