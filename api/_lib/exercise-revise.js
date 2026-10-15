/* Revise an exercise from a finished essay via Claude.
 *
 * Returns updated workspace nodes (README, steps, starter code). Persists
 * through the exercise workspace store (TinkerUserData). There is no GitHub
 * write path in Tinker for tlindow/lindowlabs.
 *
 * Uses Anthropic structured outputs (json_schema) when the model supports
 * it, otherwise a forced tool call — same helper as That's everything.
 */

"use strict";

const { callAnthropic } = require("./anthropic.js");
const revision = require("../../src/renderer/lib/exercise-revision.js");
const models = require("../../src/renderer/lib/claude-models.js");
const structured = require("../../src/renderer/lib/claude-structured.js");

const MODEL = models.EXERCISE_REVISE || "claude-opus-4-8";
const MAX_ESSAY = 12000;
const MAX_FILE_CHARS = 14000;
const MAX_FILES_IN_PROMPT = 24;

const SYSTEM_PROMPT = [
  "You revise a coding exercise for Tyler based on his finished essay.",
  "Update the exercise so its steps, README, and starter/practice stubs match what the essay asks for.",
  "Keep fixtures and tests unchanged unless the essay explicitly asks to change them.",
  "Starter files should stay stubs the learner fills in (TODO throws or empty bodies are fine).",
  "Never use an em dash. Never invent secrets or live API keys.",
  "Return a single JSON object matching the schema (steps + files).",
  "paths are relative to the exercise root (e.g. README.md, readPaymentIntentClient.js).",
  "Include every file you change. Prefer rewriting README.md Start here steps and starter stubs.",
].join("\n");

function readEssay(raw) {
  if (raw == null || typeof raw !== "string") {
    throw Object.assign(new Error("Essay body is required."), { status: 400 });
  }
  const text = raw.trim();
  if (!text) {
    throw Object.assign(new Error("Essay body is required."), { status: 400 });
  }
  if (text.length > MAX_ESSAY) {
    throw Object.assign(new Error("Essay is too long to revise from."), { status: 400 });
  }
  return text;
}

function parseModelJson(textOrObj) {
  if (textOrObj && typeof textOrObj === "object" && !Array.isArray(textOrObj)) {
    return textOrObj;
  }
  return structured.parseJsonText(textOrObj);
}

function buildUserPrompt({ exerciseId, exerciseName, essayBody, files }) {
  const lines = [
    "Exercise id: " + exerciseId,
    "Exercise name: " + (exerciseName || exerciseId),
    "",
    "Essay (source of truth for the revision):",
    essayBody,
    "",
    "Current exercise files:",
  ];
  (files || []).forEach(function (file) {
    lines.push("");
    lines.push("--- " + file.path + " ---");
    lines.push(file.content);
  });
  return lines.join("\n");
}

function validateRevisePayload(payload) {
  const parsed = parseModelJson(payload);
  if (!parsed || typeof parsed !== "object") {
    throw Object.assign(new Error("Model reply was not JSON."), { status: 502 });
  }
  return {
    steps: Array.isArray(parsed.steps) ? parsed.steps : [],
    files: Array.isArray(parsed.files) ? parsed.files : [],
  };
}

async function reviseExerciseWithClaude(opts) {
  const options = opts || {};
  const core = options.core;
  if (!core) throw new Error("exercise core required");
  const exerciseId = String(options.exerciseId || "").trim();
  if (!exerciseId) {
    throw Object.assign(new Error("exerciseId is required."), { status: 400 });
  }
  const essayBody = readEssay(options.essayBody);
  const workspace = core.normalizeWorkspace(options.workspace);
  const ex = workspace.exercises[exerciseId];
  if (!ex) {
    throw Object.assign(new Error("Exercise not found."), { status: 404 });
  }

  const files = revision.listExerciseFiles(ex.nodes, {
    maxFiles: MAX_FILES_IN_PROMPT,
    maxChars: MAX_FILE_CHARS,
  });

  const call = typeof options.callAnthropic === "function" ? options.callAnthropic : callAnthropic;
  const model = options.model || MODEL;
  const run =
    typeof options.runStructuredJsonCall === "function"
      ? options.runStructuredJsonCall
      : structured.runStructuredJsonCall.bind(structured);

  const structuredOut = await run({
    callFn: call,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: buildUserPrompt({
          exerciseId: exerciseId,
          exerciseName: ex.name,
          essayBody: essayBody,
          files: files,
        }),
      },
    ],
    model: model,
    maxTokens: options.maxTokens != null ? options.maxTokens : 8192,
    schema: structured.REVISE_SCHEMA,
    toolName: "submit_exercise_revision",
    validate: validateRevisePayload,
    friendlyError: structured.FRIENDLY_ERROR,
  });

  const parsed = structuredOut.value;
  const applied = revision.applyClaudeRevision(workspace, {
    core: core,
    exerciseId: exerciseId,
    essayBody: essayBody,
    steps: parsed.steps,
    files: parsed.files,
  });

  return Object.assign({}, applied, {
    usage: structuredOut.usage || null,
    model: model,
    mechanism: structuredOut.mechanism || null,
  });
}

module.exports = {
  MODEL,
  SYSTEM_PROMPT,
  readEssay,
  parseModelJson,
  buildUserPrompt,
  validateRevisePayload,
  reviseExerciseWithClaude,
};
