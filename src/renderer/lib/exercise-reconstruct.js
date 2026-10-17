/* Reconstruct desktop ZPD exercise from the user's technical essays.
 *
 * Claude Opus 5.5 reads all technical essays + current learning_progress,
 * picks the essay that best matches the user's ZPD (just beyond unaided),
 * and builds the coding exercise (goal, prompt, polished starting file,
 * level) from that essay's topic. No fixed curriculum. Callers pass callFn
 * so tests can mock the model.
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
  var MAX_ESSAY = 8000;
  var MAX_ESSAYS = 12;
  var MAX_PROMPT = 600;
  var MAX_FILE = 14000;
  var MAX_ZPD = 400;
  var MAX_TITLE = 200;
  var MAX_CONTEXT = 4000;

  var RECONSTRUCT_SCHEMA = {
    type: "object",
    properties: {
      sourceEssayId: { type: "string" },
      goalId: { type: "string" },
      goalTitle: { type: "string" },
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
      "sourceEssayId",
      "goalId",
      "goalTitle",
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
    "You build Tyler's desktop coding exercise from his technical essays only.\n" +
    "Pick the one essay whose topic best matches his ZPD: just beyond what he can do unaided.\n" +
    "From that essay, invent the learning goal, the next prompt, a practice path, and level (0-100).\n" +
    "startingPracticeFile must be the most beautiful, polished version of the goal code for that\n" +
    "exercise: clean, minimal, idiomatic, well-named, well-structured. Never instructional comments,\n" +
    "HTML/markdown scaffolds, TODO stubs, or half-finished templates. The prompt card carries instructions.\n" +
    "Return sourceEssayId of the essay you picked (must be one of the ids provided).\n" +
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

  function normalizeEssayList(essays) {
    var list = Array.isArray(essays) ? essays : [];
    var out = [];
    for (var i = 0; i < list.length && out.length < MAX_ESSAYS; i += 1) {
      var e = list[i];
      if (!e || typeof e !== "object") continue;
      var id = String(e.id || "").trim();
      var body = clamp(e.body || e.essayBody || "", MAX_ESSAY).trim();
      if (!id || !body) continue;
      out.push({
        id: id,
        title: clamp(e.title || "", MAX_TITLE),
        body: body,
        updatedAt: e.updatedAt || e.createdAt || null,
      });
    }
    return out;
  }

  function buildUserMessage(opts) {
    var options = opts || {};
    var progress = options.progress || {};
    if (progressApi && typeof progressApi.normalizeProgress === "function") {
      progress = progressApi.normalizeProgress(progress);
    }
    var essays = normalizeEssayList(options.essays || options.technicalEssays);
    if (!essays.length) {
      throw Object.assign(
        new Error("At least one technical essay is required."),
        { status: 400, code: "no_technical_essays" }
      );
    }
    var blocks = [
      "Current level: " + String(progress.level != null ? progress.level : 0),
      "Current goal id: " + String(progress.goalId || "(none)"),
      "Current goal title: " + String(progress.goalTitle || "(none)"),
      "Current practice path: " + String(progress.practicePath || "(none)"),
      "Current prompt:",
      "<<<CURRENT_PROMPT",
      clamp(progress.currentPrompt || "", MAX_PROMPT),
      "CURRENT_PROMPT>>>",
      "",
    ];
    if (options.technicalGoalsContext) {
      blocks.push(
        "Technical goals context (from connected Notion pages, read-only):",
        "<<<TECH_CONTEXT",
        clamp(options.technicalGoalsContext, MAX_CONTEXT),
        "TECH_CONTEXT>>>",
        ""
      );
    }
    blocks.push(
      "Technical essays (pick one sourceEssayId that best matches ZPD):",
      ""
    );
    for (var i = 0; i < essays.length; i += 1) {
      var essay = essays[i];
      blocks.push(
        "--- essay id=" + essay.id + " title=" + (essay.title || "(untitled)"),
        "<<<ESSAY_" + essay.id,
        essay.body,
        "ESSAY_" + essay.id + ">>>",
        ""
      );
    }
    blocks.push(
      "Return sourceEssayId, goalId, goalTitle, nextPrompt, startingPracticeFile,",
      "practicePath, fileName, level, and zpd. startingPracticeFile is polished goal code only."
    );
    return blocks.join("\n");
  }

  function validatePayload(payload, essays) {
    if (!payload || typeof payload !== "object") {
      throw Object.assign(new Error("Missing reconstruct payload."), { status: 502 });
    }
    var list = normalizeEssayList(essays);
    var sourceEssayId = String(payload.sourceEssayId || "").trim();
    if (!sourceEssayId) {
      throw Object.assign(new Error("sourceEssayId missing."), { status: 502 });
    }
    var matched = null;
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === sourceEssayId) {
        matched = list[i];
        break;
      }
    }
    if (!matched && list.length) {
      // Soft-fallback: if the model invents an id, keep the first essay rather than 502.
      // Prefer hard fail when essays were provided and id is unknown.
      throw Object.assign(new Error("sourceEssayId not in essay list."), {
        status: 502,
      });
    }
    var goalId = clamp(payload.goalId, 80).trim();
    var goalTitle = clamp(payload.goalTitle, MAX_TITLE).trim();
    if (!goalId || !goalTitle) {
      throw Object.assign(new Error("goal missing."), { status: 502 });
    }
    if (/formation/i.test(goalId) || /formation/i.test(goalTitle) || /\u2014/.test(goalTitle)) {
      throw Object.assign(new Error("Invalid goal."), { status: 502 });
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
    // Reject obvious instructional scaffolds in the practice file.
    if (
      /<!--\s*(Document|TODO|ask\s*=|send\s*=|return\s*=)/i.test(starting) ||
      /^\/\/\s*(TODO|Write your|Implement|Your task)/im.test(starting) ||
      /^#\s*TODO\b/im.test(starting)
    ) {
      throw Object.assign(
        new Error("startingPracticeFile must not include instructional scaffolds."),
        { status: 502 }
      );
    }
    var zpdIn = payload.zpd && typeof payload.zpd === "object" ? payload.zpd : {};
    return {
      sourceEssayId: sourceEssayId,
      sourceEssayTitle: matched ? matched.title || "" : "",
      goalId: goalId,
      goalTitle: goalTitle,
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
      sourceEssayId: v.sourceEssayId,
      sourceEssayTitle: v.sourceEssayTitle || "",
      goalId: v.goalId,
      goalTitle: v.goalTitle,
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
   * @param {Array} opts.essays technical essays [{id,title,body}]
   * @param {object} opts.progress
   * @param {function} opts.callFn
   * @param {string} [opts.technicalGoalsContext]
   * @param {object} [opts.structuredApi]
   * @param {string} [opts.model]
   */
  function reconstructFromTechnicalEssays(opts) {
    var options = opts || {};
    var callFn = options.callFn;
    if (typeof callFn !== "function") {
      return Promise.reject(new Error("callFn is required"));
    }
    var structuredApi = options.structuredApi || structured;
    if (!structuredApi || typeof structuredApi.runStructuredJsonCall !== "function") {
      return Promise.reject(new Error("structured helper unavailable"));
    }
    var essays = normalizeEssayList(options.essays || options.technicalEssays);
    var user = buildUserMessage(options);
    var model = options.model || MODEL;
    return structuredApi
      .runStructuredJsonCall({
        callFn: callFn,
        model: model,
        schema: RECONSTRUCT_SCHEMA,
        toolName: "submit_exercise_reconstruct",
        toolDescription:
          "Return the essay-derived desktop exercise goal, prompt, polished file, and level.",
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: user }],
        maxTokens: 16000,
        validate: function (payload) {
          return validatePayload(payload, essays);
        },
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

  /** @deprecated Prefer reconstructFromTechnicalEssays. */
  function reconstructFromEssay(opts) {
    var options = opts || {};
    var essays = options.essays || options.technicalEssays;
    if (!essays || !essays.length) {
      if (options.essayBody) {
        essays = [
          {
            id: options.essayId || "essay",
            title: options.essayTitle || "",
            body: options.essayBody,
            updatedAt: options.essayUpdatedAt || null,
          },
        ];
      }
    }
    return reconstructFromTechnicalEssays(
      Object.assign({}, options, { essays: essays })
    );
  }

  return {
    MODEL: MODEL,
    RECONSTRUCT_SCHEMA: RECONSTRUCT_SCHEMA,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    revisionKey: revisionKey,
    alreadyReconstructed: alreadyReconstructed,
    normalizeEssayList: normalizeEssayList,
    buildUserMessage: buildUserMessage,
    validatePayload: validatePayload,
    toCalibration: toCalibration,
    reconstructFromTechnicalEssays: reconstructFromTechnicalEssays,
    reconstructFromEssay: reconstructFromEssay,
  };
});
