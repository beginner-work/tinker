/* Revise an exercise from a finished essay via Claude.
 *
 * Returns updated workspace nodes (README, steps, starter code). Persists
 * through the exercise workspace store (TinkerUserData). There is no GitHub
 * write path in Tinker for tlindow/lindowlabs.
 */

"use strict";

const { callAnthropic } = require("./anthropic.js");
const revision = require("../../src/renderer/lib/exercise-revision.js");

const MODEL = "claude-opus-4-8";
const MAX_ESSAY = 12000;
const MAX_FILE_CHARS = 14000;
const MAX_FILES_IN_PROMPT = 24;

const SYSTEM_PROMPT = [
  "You revise a coding exercise for Tyler based on his finished essay.",
  "Update the exercise so its steps, README, and starter/practice stubs match what the essay asks for.",
  "Keep fixtures and tests unchanged unless the essay explicitly asks to change them.",
  "Starter files should stay stubs the learner fills in (TODO throws or empty bodies are fine).",
  "Never use an em dash. Never invent secrets or live API keys.",
  "Return a single JSON object and nothing else:",
  '{ "steps": string[], "files": [ { "path": string, "content": string } ] }',
  "paths are relative to the exercise root (e.g. README.md, readPaymentIntentClient.js).",
  "Include every file you change. Prefer rewriting README.md Start here steps and starter stubs.",
  "Never wrap the JSON in code fences.",
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

function parseModelJson(text) {
  const raw = String(text || "").trim();
  if (!raw) throw Object.assign(new Error("Empty model reply."), { status: 502 });
  let candidate = raw;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidate = fenced[1].trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw Object.assign(new Error("Model reply was not JSON."), { status: 502 });
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw Object.assign(new Error("Model reply was not valid JSON."), { status: 502 });
  }
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
  const result = await call({
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
    model: options.model || MODEL,
    maxTokens: options.maxTokens != null ? options.maxTokens : 8192,
  });

  const parsed = parseModelJson(result && result.text);
  const applied = revision.applyClaudeRevision(workspace, {
    core: core,
    exerciseId: exerciseId,
    essayBody: essayBody,
    steps: Array.isArray(parsed.steps) ? parsed.steps : null,
    files: Array.isArray(parsed.files) ? parsed.files : [],
  });

  return Object.assign({}, applied, {
    usage: result && result.usage ? result.usage : null,
    model: options.model || MODEL,
  });
}

module.exports = {
  MODEL,
  SYSTEM_PROMPT,
  readEssay,
  parseModelJson,
  buildUserPrompt,
  reviseExerciseWithClaude,
};
