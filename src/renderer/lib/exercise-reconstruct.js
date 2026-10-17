/* Reconstruct desktop ZPD exercise from a finished technical essay.
 *
 * Claude Opus 5.5 reads the essay + current learning_progress and returns
 * next prompt, starting practice file content, practice path, and level.
 * Goal stays. Callers pass callFn so tests can mock the model.
 *
 * Browser: window.tinkerExerciseReconstruct. Node: require.
 */
(function (root, factory) {
  var api = factory(
    typeof require === "function"
      ? (function () {
          try { return require("./claude-models.js"); } catch (e) { return null; }
        })()
      : (typeof window !== "undefined" ? window.tinkerClaudeModels : null),
    typeof require === "function"
      ? (function () {
          try { return require("./claude-structured.js"); } catch (e) { return null; }
        })()
      : (typeof window !== "undefined" ? window.tinkerClaudeStructured : null),
    typeof require === "function"
      ? (function () {
          try { return require("./learning-progress.js"); } catch (e) { return null; }
        })()
      : (typeof window !== "undefined" ? window.tinkerLearningProgress : null)
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.tinkerExerciseReconstruct = api;
  } else if (root) {
    root.tinkerExerciseReconstruct = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  models,
  structured,
  progressApi
) {
  "use strict";

  var MODEL =
    (models && (models.EXERCISE_REFACTOR || models.EXERCISE_REVISE)) ||
    "claude-opus-5-5";
  var MAX_ESSAY = 12000;
  var MAX_PROMPT = 600;
  var MAX_FILE = 14000;
  var MAX_ZPD = 400;

  var RECONSTRUCT_SCHEMA = {
    type: "object",
    properties: {
      nextPrompt: { type: "string" },
      level: { type: "number" },
      practicePath: { type: "string" },
      fileName: { type: "string" },
      startingPracticeFile: { type: "string" },
      zpd: {
        type: "object",
        properties: {
          unaided: { type: "string" },
          justBeyond: { type: "string" },
        },
        required: ["unaided", "justBeyond"],
        additionalProperties: false,
      },
    },
    required: [
      "nextPrompt",
      "level",
      "practicePath",
      "fileName",
      "startingPracticeFile",
      "zpd",
    ],
    additionalProperties: false,
  };

  var SYSTEM_PROMPT =
    "You reconstruct Tyler's desktop coding exercise from a finished technical essay.\n" +
    "Keep the same learning goal. Do not invent a new goal.\n" +
    "Return the next prompt, starting practice file content, practice path, file name,\n" +
    "level (0-100), and a ZPD pair (unaided / just beyond) matched to what the essay shows he can do.\n" +
    "startingPracticeFile is the stub he should attempt next (light scaffolding, not a finished answer).\n" +
    "Never mention Formation. Never use an em dash. Reply with structured JSON only.";

  function clamp(text, max) {
    var s = text == null ? "" : String(text);
    if (s.length <= max) return s;
    return s.slice(0, max);
  }

  function revisionKey(essayId, essayBody, updatedAt) {
    var id = String(essayId || "").trim();
    var body = String(essayBody || "");
    var stamp = updatedAt == null ? "" : String(updatedAt);
    var raw = id + "\n" + stamp + "\n" + body;
    // FNV-1a 32-bit — stable, no crypto dependency in the browser.
    var hash = 0x811c9dc5;
    for (var i = 0; i < raw.length; i += 1) {
      hash ^= raw.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return id + ":" + (hash >>> 0).toString(16);
  }

  function alreadyReconstructed(progress, key) {
    if (!progress || !key) return false;
    var prev = progress.essayReconstructKey || progress.reconstructKey;
    return String(prev || "") === String(key);
  }

  function buildUserMessage(opts) {
    var options = opts || {};
    var progress = options.progress || {};
    if (progressApi && typeof progressApi.normalizeProgress === "function") {
      progress = progressApi.normalizeProgress(progress);
    }
    var essay = clamp(options.essayBody, MAX_ESSAY).trim();
    if (!essay) {
      throw Object.assign(new Error("Essay body is required."), { status: 400 });
    }
    return [
      "Goal id (keep): " + String(progress.goalId || "openapi-from-scratch"),
      "Goal title (keep): " +
        String(progress.goalTitle || "Write an OpenAPI spec from scratch by feel"),
      "Exercise id: " + String(progress.exerciseId || "api-design"),
      "Current level: " + String(progress.level != null ? progress.level : 0),
      "Current practice path: " + String(progress.practicePath || ""),
      "Current file name: " + String(progress.fileName || ""),
      "Current prompt:",
      "<<<CURRENT_PROMPT",
      clamp(progress.currentPrompt || "", MAX_PROMPT),
      "CURRENT_PROMPT>>>",
      "",
      "Finished technical essay (signal for demonstrated level):",
      "<<<ESSAY",
      essay,
      "ESSAY>>>",
      "",
      "Reconstruct nextPrompt, startingPracticeFile, practicePath, fileName, level, and zpd.",
      "Do not change the goal.",
    ].join("\n");
  }

  function validatePayload(payload) {
    if (!payload || typeof payload !== "object") {
      throw Object.assign(new Error("Missing reconstruct payload."), { status: 502 });
    }
    var nextPrompt = clamp(payload.nextPrompt, MAX_PROMPT).trim();
    if (!nextPrompt) {
      throw Object.assign(new Error("nextPrompt missing."), { status: 502 });
    }
    if (/\u2014/.test(nextPrompt) || /formation/i.test(nextPrompt)) {
      throw Object.assign(new Error("Invalid nextPrompt."), { status: 502 });
    }
    var level = Number(payload.level);
    if (!Number.isFinite(level)) {
      throw Object.assign(new Error("level missing."), { status: 502 });
    }
    level = Math.max(0, Math.min(100, Math.round(level)));
    var practicePath = String(payload.practicePath || "")
      .replace(/^\/+|\/+$/g, "")
      .replace(/\\/g, "/")
      .trim();
    if (!practicePath || /formation/i.test(practicePath)) {
      throw Object.assign(new Error("practicePath missing."), { status: 502 });
    }
    var fileName = clamp(payload.fileName, 120).trim() || practicePath.split("/").pop();
    var starting = clamp(payload.startingPracticeFile, MAX_FILE);
    if (/formation/i.test(starting) || /\u2014/.test(starting)) {
      throw Object.assign(new Error("Invalid startingPracticeFile."), { status: 502 });
    }
    var zpdIn = payload.zpd && typeof payload.zpd === "object" ? payload.zpd : {};
    return {
      nextPrompt: nextPrompt,
      level: level,
      practicePath: practicePath,
      fileName: fileName,
      startingPracticeFile: starting,
      zpd: {
        unaided: clamp(zpdIn.unaided || "", MAX_ZPD),
        justBeyond: clamp(zpdIn.justBeyond || "", MAX_ZPD),
      },
    };
  }

  function toCalibration(value) {
    var v = value || {};
    return {
      nextPrompt: v.nextPrompt,
      level: v.level,
      practicePath: v.practicePath,
      fileName: v.fileName,
      zpd: v.zpd,
      goalAchieved: false,
      revisedContent: v.startingPracticeFile,
      startingPracticeFile: v.startingPracticeFile,
    };
  }

  /**
   * @param {object} opts
   * @param {string} opts.essayBody
   * @param {object} opts.progress
   * @param {function} opts.callFn
   * @param {object} [opts.structuredApi]
   * @param {string} [opts.model]
   */
  function reconstructFromEssay(opts) {
    var options = opts || {};
    var callFn = options.callFn;
    if (typeof callFn !== "function") {
      return Promise.reject(new Error("callFn is required"));
    }
    var structuredApi = options.structuredApi || structured;
    if (!structuredApi || typeof structuredApi.runStructuredJsonCall !== "function") {
      return Promise.reject(new Error("structured helper unavailable"));
    }
    var user = buildUserMessage(options);
    var model = options.model || MODEL;
    return structuredApi
      .runStructuredJsonCall({
        callFn: callFn,
        model: model,
        schema: RECONSTRUCT_SCHEMA,
        toolName: "submit_exercise_reconstruct",
        toolDescription:
          "Return the reconstructed desktop exercise prompt, file, and level.",
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: user }],
        maxTokens: 16000,
        validate: validatePayload,
        attempts: 2,
        effort: "low",
      })
      .then(function (result) {
        return {
          value: result.value,
          calibration: toCalibration(result.value),
          mechanism: result.mechanism,
        };
      });
  }

  return {
    MODEL: MODEL,
    RECONSTRUCT_SCHEMA: RECONSTRUCT_SCHEMA,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    revisionKey: revisionKey,
    alreadyReconstructed: alreadyReconstructed,
    buildUserMessage: buildUserMessage,
    validatePayload: validatePayload,
    toCalibration: toCalibration,
    reconstructFromEssay: reconstructFromEssay,
  };
});
