/* Inline exercise refactor: select a range, ask Claude, apply or reject.
 *
 * Shared prompt + JSON parse for the desktop /repo editor. The UI calls
 * window.tinker.callClaude with EXERCISE_REFACTOR from claude-models.
 */
(function (root, factory) {
  const api = factory(
    (typeof module === "object" && module.exports
      ? require("./claude-models.js")
      : null) ||
      (typeof window !== "undefined" ? window.tinkerClaudeModels : null) ||
      {}
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.tinkerExerciseRefactor = api;
  } else if (root) {
    root.tinkerExerciseRefactor = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (models) {
  "use strict";

  const MODEL =
    (models && models.EXERCISE_REFACTOR) || "claude-opus-5-5";
  const MAX_SELECTION = 24000;
  const MAX_INSTRUCTION = 2000;
  const MAX_CONTEXT = 40000;

  const SYSTEM_PROMPT = [
    "You refactor a selected region inside a coding exercise file for Tyler.",
    "Change only what the instruction asks for. Keep the rest of the file untouched.",
    "Return the full replacement text for the selected region only (not the whole file).",
    "Never use an em dash. Never invent secrets or live API keys.",
    "Never wrap the reply in code fences unless the selection itself is fenced.",
    "Return a single JSON object and nothing else:",
    '{ "replacement": string, "summary": string }',
    "replacement is the new text for the selection. summary is one short sentence.",
  ].join("\n");

  function clamp(text, max) {
    const s = text == null ? "" : String(text);
    if (s.length <= max) return s;
    return s.slice(0, max);
  }

  function parseRefactorReply(textOrObj) {
    let parsed;
    if (textOrObj && typeof textOrObj === "object" && !Array.isArray(textOrObj)) {
      parsed = textOrObj;
    } else {
      const raw = String(textOrObj || "").trim();
      if (!raw) {
        throw Object.assign(new Error("Empty model reply."), { status: 502 });
      }
      let candidate = raw;
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenced) candidate = fenced[1].trim();
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      if (start === -1 || end === -1 || end <= start) {
        throw Object.assign(new Error("Model reply was not JSON."), { status: 502 });
      }
      try {
        parsed = JSON.parse(candidate.slice(start, end + 1));
      } catch {
        throw Object.assign(new Error("Model reply was not valid JSON."), {
          status: 502,
        });
      }
    }
    if (!parsed || typeof parsed.replacement !== "string") {
      throw Object.assign(new Error("Model reply missing replacement."), {
        status: 502,
      });
    }
    return {
      replacement: parsed.replacement,
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim().slice(0, 200)
          : "Proposed refactor",
    };
  }

  function buildRefactorUserMessage(opts) {
    const options = opts || {};
    const fileName = String(options.fileName || "file").trim() || "file";
    const instruction = clamp(options.instruction, MAX_INSTRUCTION).trim();
    if (!instruction) {
      throw Object.assign(new Error("Say what to refactor."), { status: 400 });
    }
    const selected = clamp(options.selectedText, MAX_SELECTION);
    if (!selected) {
      throw Object.assign(new Error("Select text or a step to refactor."), {
        status: 400,
      });
    }
    const before = clamp(options.beforeContext || "", MAX_CONTEXT);
    const after = clamp(options.afterContext || "", MAX_CONTEXT);
    const lines = [
      "File: " + fileName,
      "",
      "Instruction:",
      instruction,
      "",
      "Selected region (replace this entire region):",
      "<<<SELECTION",
      selected,
      "SELECTION>>>",
    ];
    if (before) {
      lines.push("", "Context before selection:", before);
    }
    if (after) {
      lines.push("", "Context after selection:", after);
    }
    return lines.join("\n");
  }

  function applyReplacement(fullText, from, to, replacement) {
    const doc = fullText == null ? "" : String(fullText);
    const start = Math.max(0, Math.min(Number(from) || 0, doc.length));
    const end = Math.max(start, Math.min(Number(to) || 0, doc.length));
    const next = String(replacement == null ? "" : replacement);
    return doc.slice(0, start) + next + doc.slice(end);
  }

  const REPLY_SCHEMA = {
    type: "object",
    properties: {
      replacement: { type: "string" },
      summary: { type: "string" },
    },
    required: ["replacement", "summary"],
    additionalProperties: false,
  };

  return {
    MODEL: MODEL,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    MAX_SELECTION: MAX_SELECTION,
    REPLY_SCHEMA: REPLY_SCHEMA,
    TOOL_NAME: "submit_exercise_refactor",
    parseRefactorReply: parseRefactorReply,
    buildRefactorUserMessage: buildRefactorUserMessage,
    applyReplacement: applyReplacement,
  };
});
