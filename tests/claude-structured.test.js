/* Anthropic structured JSON helper: schema path, tool fallback, retry. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const models = require("../src/renderer/lib/claude-models.js");
const structured = require("../src/renderer/lib/claude-structured.js");
const evaluate = require("../src/renderer/lib/exercise-evaluate.js");
const refactor = require("../src/renderer/lib/exercise-refactor.js");
const { extractContent } = require("../api/_lib/anthropic.js");

const html = fs.readFileSync(
  path.join(root, "src/renderer/repo/index.html"),
  "utf8"
);
const ui = fs.readFileSync(
  path.join(root, "src/renderer/repo/exercise-workspace-ui.js"),
  "utf8"
);
const platform = fs.readFileSync(
  path.join(root, "src/renderer/platform-mobile.js"),
  "utf8"
);
const converse = fs.readFileSync(
  path.join(root, "api/claude/converse.js"),
  "utf8"
);
const anthropicSrc = fs.readFileSync(
  path.join(root, "api/_lib/anthropic.js"),
  "utf8"
);

const goodEvaluate = {
  feedback: "You named PaymentIntent. Still missing capture under ask.",
  summary: "Finer next step for the gap on capture.",
  nextStepPath: "01-smallest-valid-spec/README.md",
  nextStepContent: "# 01\n\nDo one path only.\n",
  aggressiveness: { struggle: "hard", action: "finer" },
};

test("claude-opus-5-5 uses json_schema structured outputs (output_format)", () => {
  assert.equal(models.EXERCISE_REFACTOR, "claude-opus-5-5");
  assert.equal(structured.supportsJsonSchemaOutput("claude-opus-5-5"), true);
  const req = structured.buildStructuredRequest({
    model: "claude-opus-5-5",
    schema: structured.EVALUATE_SCHEMA,
    toolName: "submit_exercise_evaluation",
  });
  assert.equal(req.mechanism, "json_schema");
  assert.equal(req.output_format.type, "json_schema");
  assert.ok(req.output_format.schema);
  assert.equal(req.output_config.format.type, "json_schema");
  assert.equal(req.tools, null);
  assert.doesNotMatch(
    JSON.stringify(req),
    /openai|codex|gpt-/i
  );
});

test("unsupported model falls back to forced tool_choice tool call", () => {
  const req = structured.buildStructuredRequest({
    model: "claude-instant-1.2",
    schema: structured.REFACTOR_SCHEMA,
    toolName: "submit_exercise_refactor",
  });
  assert.equal(req.mechanism, "tool");
  assert.equal(req.tool_choice.type, "tool");
  assert.equal(req.tool_choice.name, "submit_exercise_refactor");
  assert.equal(req.tools[0].name, "submit_exercise_refactor");
  assert.equal(req.tools[0].input_schema.type, "object");
  assert.equal(req.output_format, null);
});

test("extractStructuredPayload reads tool_use input from mocked reply", () => {
  const extracted = structured.extractStructuredPayload({
    text: "",
    toolUse: {
      name: "submit_exercise_evaluation",
      input: goodEvaluate,
    },
  });
  assert.equal(extracted.feedback, goodEvaluate.feedback);
  const fromText = structured.extractStructuredPayload({
    text: JSON.stringify(goodEvaluate),
  });
  assert.equal(fromText.nextStepPath, goodEvaluate.nextStepPath);
});

test("anthropic extractContent surfaces tool_use as structured + text JSON", () => {
  const out = extractContent({
    content: [
      {
        type: "tool_use",
        id: "toolu_1",
        name: "submit_exercise_refactor",
        input: { replacement: "new", summary: "Renamed" },
      },
    ],
  });
  assert.equal(out.toolUse.name, "submit_exercise_refactor");
  assert.equal(out.structured.replacement, "new");
  assert.equal(JSON.parse(out.text).summary, "Renamed");
});

test("runStructuredJsonCall validates mocked json_schema reply", async () => {
  const out = await structured.runStructuredJsonCall({
    callFn: async (payload) => {
      assert.equal(payload.output_format.type, "json_schema");
      assert.equal(payload.output_config.format.type, "json_schema");
      assert.ok(!payload.tools);
      return { text: JSON.stringify(goodEvaluate) };
    },
    model: "claude-opus-5-5",
    schema: evaluate.REPLY_SCHEMA || structured.EVALUATE_SCHEMA,
    toolName: evaluate.TOOL_NAME,
    system: "sys",
    messages: [{ role: "user", content: "hi" }],
    maxTokens: 100,
    validate: (payload) => evaluate.parseEvaluateReply(payload),
  });
  assert.equal(out.mechanism, "json_schema");
  assert.match(out.value.feedback, /PaymentIntent/);
  assert.equal(out.value.aggressiveness.action, "finer");
  assert.equal(out.attempt, 1);
});

test("runStructuredJsonCall retries once then friendly error", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      structured.runStructuredJsonCall({
        callFn: async () => {
          calls += 1;
          return { text: "not valid json at all {{{" };
        },
        model: "claude-opus-5-5",
        schema: structured.EVALUATE_SCHEMA,
        toolName: "submit_exercise_evaluation",
        system: "sys",
        messages: [{ role: "user", content: "hi" }],
        validate: (payload) => evaluate.parseEvaluateReply(payload),
      }),
    (err) =>
      err &&
      err.code === "STRUCTURED_JSON_FAILED" &&
      /shape we couldn't use/i.test(err.message)
  );
  assert.equal(calls, 2);
});

test("runStructuredJsonCall forced-tool path reads tool_use input", async () => {
  const out = await structured.runStructuredJsonCall({
    callFn: async (payload) => {
      assert.equal(payload.tool_choice.type, "tool");
      assert.equal(payload.tools[0].name, "submit_exercise_refactor");
      return {
        text: "",
        toolUse: {
          name: "submit_exercise_refactor",
          input: { replacement: "Y", summary: "ok" },
        },
      };
    },
    model: "claude-instant-1.2",
    schema: refactor.REPLY_SCHEMA || structured.REFACTOR_SCHEMA,
    toolName: refactor.TOOL_NAME,
    system: "sys",
    messages: [{ role: "user", content: "hi" }],
    validate: (payload) => refactor.parseRefactorReply(payload),
  });
  assert.equal(out.mechanism, "tool");
  assert.equal(out.value.replacement, "Y");
});

test("repo UI and converse wire structured outputs through callClaude", () => {
  assert.match(html, /claude-structured\.js/);
  assert.match(ui, /runStructuredJsonCall/);
  assert.match(ui, /REPLY_SCHEMA|EVALUATE_SCHEMA/);
  assert.match(platform, /output_format/);
  assert.match(platform, /tool_choice/);
  assert.match(converse, /output_format/);
  assert.match(converse, /tool_choice/);
  assert.match(anthropicSrc, /output_config/);
  assert.match(anthropicSrc, /tool_use/);
  assert.doesNotMatch(ui, /openai|codex|gpt-/i);
  assert.doesNotMatch(anthropicSrc, /openai|codex|gpt-/i);
});

test("evaluate and refactor schemas match shared helper", () => {
  assert.deepEqual(
    evaluate.REPLY_SCHEMA.required,
    structured.EVALUATE_SCHEMA.required
  );
  assert.deepEqual(
    refactor.REPLY_SCHEMA.required,
    structured.REFACTOR_SCHEMA.required
  );
  assert.equal(evaluate.TOOL_NAME, "submit_exercise_evaluation");
  assert.equal(refactor.TOOL_NAME, "submit_exercise_refactor");
});
