/* That's everything: evaluate an attempt, revise the practice file, and
 * size the next prompt to Tyler's ZPD (zone of proximal development).
 *
 * Claude Opus (EXERCISE_REFACTOR / claude-opus-5-5) returns:
 *   (a) revisedContent: applied into the open practice file automatically
 *   (b) zpd: what he did unaided vs what is just beyond
 *   (c) nextPrompt: one or two sentences for the next attempt
 * Hidden aggressiveness dial: struggle -> smaller prompt; easy -> bigger.
 * Formation curriculum is never referenced or restored. Claude only.
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
    window.tinkerExerciseEvaluate = api;
  } else if (root) {
    root.tinkerExerciseEvaluate = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (models) {
  "use strict";

  const MODEL =
    (models && models.EXERCISE_REFACTOR) || "claude-opus-5-5";
  const MAX_ANSWER = 24000;
  const MAX_README = 16000;
  const MAX_FEEDBACK = 900;
  const MAX_SUMMARY = 200;
  const MAX_PROMPT = 600;
  const MAX_ZPD = 400;
  const MAX_REVISED = 24000;

  const SYSTEM_PROMPT = [
    "You evaluate Tyler's coding attempt toward a single learning goal.",
    "Default goal: write an OpenAPI spec from scratch by feel, no copy-paste.",
    "Plain-English pseudocode is a valid first attempt.",
    "Compare his attempt to the current prompt and goal only.",
    "",
    "Return three calibrated pieces:",
    "(a) revisedContent: a lightly improved version of HIS file content,",
    "    applied into the editor. Keep his voice and structure. Fix clear",
    "    gaps that sit inside his zone. Never dump a full finished solution.",
    "    Never paste YAML or code he should still invent on the next turn.",
    "(b) zpd: short plain English: unaided (what he did on his own) and",
    "    justBeyond (the next reachable stretch).",
    "(c) nextPrompt: one or two sentences naming exactly what to attempt next.",
    "",
    "Hidden aggressiveness dial (do not mention the dial, scores, or labels",
    "in any user-facing field; they are internal only):",
    "- If he struggled (gaps, confusion, thin answer): action finer;",
    "  smaller nextPrompt with more scaffolding; nudge level down or hold.",
    "- If he did fine: action keep; nextPrompt targets remaining gaps.",
    "- If it was easy (solid, complete): action skip_ahead; bigger next",
    "  prompt, raise level, drop redundant scaffolding.",
    "",
    "When the goal is achieved (he can write the OpenAPI contract from",
    "scratch by feel), set goalAchieved true and level to 100.",
    "Never mention Formation, Formation.dev, or any retired curriculum.",
    "Never use an em dash.",
    "Never ask where he should start; you already know the path.",
    "",
    "Return a single JSON object and nothing else:",
    '{ "feedback": string, "summary": string, "revisedContent": string,',
    '  "nextPrompt": string, "zpd": { "unaided": string, "justBeyond": string },',
    '  "level": number, "goalAchieved": boolean, "practicePath": string,',
    '  "aggressiveness": { "struggle": "hard"|"ok"|"easy",',
    '  "action": "finer"|"keep"|"skip_ahead" } }',
    "feedback is 2 to 5 short sentences. summary is one short sentence.",
    "nextPrompt is one or two sentences. level is 0 to 100.",
    "practicePath may be empty to keep the current file path.",
  ].join("\n");

  function clamp(text, max) {
    const s = text == null ? "" : String(text);
    if (s.length <= max) return s;
    return s.slice(0, max);
  }

  function clampLevel(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(100, Math.round(x)));
  }

  function parseStepsJson(raw) {
    if (raw == null) return null;
    if (typeof raw === "object" && !Array.isArray(raw)) return raw;
    const text = String(raw).trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function listSteps(stepsDoc) {
    const doc = parseStepsJson(stepsDoc);
    if (!doc || !Array.isArray(doc.steps)) return [];
    return doc.steps
      .filter(function (s) {
        return s && (s.id != null || s.folder);
      })
      .map(function (s) {
        return {
          id: String(s.id != null ? s.id : ""),
          folder: String(s.folder || "").replace(/^\/+|\/+$/g, ""),
          title: String(s.title || s.folder || s.id || ""),
          goal: String(s.goal || ""),
          check: s.check == null ? null : String(s.check),
        };
      })
      .filter(function (s) {
        return !!s.folder;
      });
  }

  function findCurrentStep(steps, filePath) {
    const path = String(filePath || "")
      .replace(/^\/+|\/+$/g, "")
      .replace(/\\/g, "/");
    if (!path) return { index: -1, step: null };
    const list = Array.isArray(steps) ? steps : [];
    let best = { index: -1, step: null, len: -1 };
    for (let i = 0; i < list.length; i += 1) {
      const folder = list[i].folder;
      if (!folder) continue;
      if (path === folder || path.indexOf(folder + "/") === 0) {
        if (folder.length > best.len) {
          best = { index: i, step: list[i], len: folder.length };
        }
      }
    }
    return { index: best.index, step: best.step };
  }

  function nextStepAfter(steps, currentIndex) {
    const list = Array.isArray(steps) ? steps : [];
    if (currentIndex < 0 || currentIndex + 1 >= list.length) return null;
    return list[currentIndex + 1];
  }

  function readmePathForStep(step) {
    if (!step || !step.folder) return "";
    return String(step.folder).replace(/^\/+|\/+$/g, "") + "/README.md";
  }

  function normalizeStruggle(value) {
    const s = String(value || "")
      .trim()
      .toLowerCase();
    if (s === "hard" || s === "struggled" || s === "struggle") return "hard";
    if (s === "easy" || s === "skip" || s === "skip_ahead") return "easy";
    return "ok";
  }

  function normalizeAction(value, struggle) {
    const a = String(value || "")
      .trim()
      .toLowerCase();
    if (a === "finer" || a === "split" || a === "scaffold") return "finer";
    if (a === "skip_ahead" || a === "skip" || a === "merge") return "skip_ahead";
    if (a === "keep" || a === "hold") return "keep";
    if (struggle === "hard") return "finer";
    if (struggle === "easy") return "skip_ahead";
    return "keep";
  }

  function banFormation(text, label) {
    if (/formation/i.test(String(text || ""))) {
      throw Object.assign(new Error(label + " must not mention Formation."), {
        status: 502,
      });
    }
  }

  function parseEvaluateReply(textOrObj) {
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
    if (!parsed || typeof parsed.feedback !== "string" || !parsed.feedback.trim()) {
      throw Object.assign(new Error("Model reply missing feedback."), {
        status: 502,
      });
    }
    const feedback = clamp(parsed.feedback.trim(), MAX_FEEDBACK);
    banFormation(feedback, "Feedback");

    const revisedContent =
      typeof parsed.revisedContent === "string"
        ? clamp(parsed.revisedContent, MAX_REVISED)
        : typeof parsed.nextStepContent === "string"
          ? clamp(parsed.nextStepContent, MAX_REVISED)
          : "";
    banFormation(revisedContent, "Revised content");

    const nextPromptRaw =
      typeof parsed.nextPrompt === "string" && parsed.nextPrompt.trim()
        ? parsed.nextPrompt.trim()
        : typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : "";
    const nextPrompt = clamp(nextPromptRaw, MAX_PROMPT);
    banFormation(nextPrompt, "Next prompt");

    const zpdIn = parsed.zpd && typeof parsed.zpd === "object" ? parsed.zpd : {};
    const zpd = {
      unaided: clamp(
        typeof zpdIn.unaided === "string" ? zpdIn.unaided.trim() : "",
        MAX_ZPD
      ),
      justBeyond: clamp(
        typeof zpdIn.justBeyond === "string" ? zpdIn.justBeyond.trim() : "",
        MAX_ZPD
      ),
    };
    banFormation(zpd.unaided + "\n" + zpd.justBeyond, "ZPD");

    const practicePath =
      typeof parsed.practicePath === "string"
        ? parsed.practicePath.replace(/^\/+|\/+$/g, "").replace(/\\/g, "/")
        : typeof parsed.nextStepPath === "string"
          ? parsed.nextStepPath.replace(/^\/+|\/+$/g, "").replace(/\\/g, "/")
          : "";
    banFormation(practicePath, "Practice path");

    const agg =
      parsed.aggressiveness && typeof parsed.aggressiveness === "object"
        ? parsed.aggressiveness
        : {};
    const struggle = normalizeStruggle(agg.struggle);
    const action = normalizeAction(agg.action, struggle);
    const goalAchieved = !!parsed.goalAchieved;
    let level = clampLevel(parsed.level);
    if (goalAchieved) level = 100;

    return {
      feedback: feedback,
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? clamp(parsed.summary.trim(), MAX_SUMMARY)
          : "Calibrated the next attempt",
      revisedContent: revisedContent,
      nextPrompt: nextPrompt,
      zpd: zpd,
      level: level,
      goalAchieved: goalAchieved,
      practicePath: practicePath,
      // Legacy aliases so older callers/tests keep a stable shape.
      nextStepPath: practicePath,
      nextStepContent: revisedContent,
      aggressiveness: { struggle: struggle, action: action },
    };
  }

  function buildEvaluateUserMessage(opts) {
    const options = opts || {};
    const answer = clamp(options.answerText, MAX_ANSWER);
    if (!String(answer || "").trim()) {
      throw Object.assign(new Error("Write an answer before That's everything."), {
        status: 400,
      });
    }
    const current = options.currentStep || {};
    const progress = options.progress || {};
    const lines = [
      "Goal id: " + String(options.goalId || progress.goalId || "openapi-from-scratch"),
      "Goal title: " +
        String(
          options.goalTitle ||
            progress.goalTitle ||
            "Write an OpenAPI spec from scratch by feel"
        ),
      "Exercise id: " + String(options.exerciseId || ""),
      "Exercise name: " + String(options.exerciseName || options.exerciseId || ""),
      "Answer file: " + String(options.filePath || "file"),
      "Current level (0-100): " +
        String(
          progress.level != null
            ? progress.level
            : options.level != null
              ? options.level
              : 0
        ),
      "Current prompt (what he was asked to attempt):",
      "<<<CURRENT_PROMPT",
      clamp(
        options.currentPrompt || progress.currentPrompt || "",
        MAX_PROMPT
      ),
      "CURRENT_PROMPT>>>",
      "",
      "Current step context (optional curriculum metadata):",
      "id: " + String(current.id || ""),
      "folder: " + String(current.folder || ""),
      "title: " + String(current.title || ""),
      "goal: " + String(current.goal || ""),
      "",
      "Current step README (goals / instructions, may be empty):",
      "<<<CURRENT_README",
      clamp(options.currentReadme || "", MAX_README),
      "CURRENT_README>>>",
      "",
      "Tyler's attempt (evaluate and lightly revise this file):",
      "<<<ANSWER",
      answer,
      "ANSWER>>>",
      "",
      "Essay signal (optional; intuit starting point; never ask where to start):",
      "<<<ESSAYS",
      clamp(options.essaySignal || "", 4000),
      "ESSAYS>>>",
      "",
      "Remember the hidden aggressiveness dial. Never mention Formation.",
      "Return revisedContent for the same practice file, a ZPD pair, and",
      "a nextPrompt sized to his zone.",
    ];
    return lines.join("\n");
  }

  function applyRevisedContent(workspace, opts) {
    const options = opts || {};
    const core = options.core;
    const revision = options.revision;
    if (!core) throw new Error("exercise core required");
    if (!revision || typeof revision.findNodeByPath !== "function") {
      throw new Error("exercise revision helper required");
    }
    const exerciseId = String(options.exerciseId || "").trim();
    if (!exerciseId) {
      throw Object.assign(new Error("exerciseId is required."), { status: 400 });
    }
    const path = String(options.practicePath || options.nextStepPath || "")
      .replace(/^\/+|\/+$/g, "")
      .replace(/\\/g, "/");
    if (!path) {
      throw Object.assign(new Error("Practice file path is required."), {
        status: 400,
      });
    }
    if (/formation/i.test(path)) {
      throw Object.assign(new Error("Formation curriculum must never appear."), {
        status: 400,
      });
    }
    const content =
      options.revisedContent != null
        ? String(options.revisedContent)
        : options.nextStepContent == null
          ? ""
          : String(options.nextStepContent);
    if (/formation/i.test(content)) {
      throw Object.assign(new Error("Formation curriculum must never appear."), {
        status: 400,
      });
    }
    let state = core.normalizeWorkspace(options.workspace);
    if (!state.exercises[exerciseId]) {
      throw Object.assign(new Error("Exercise not found."), { status: 404 });
    }
    if (typeof revision.writePathContent === "function") {
      const written = revision.writePathContent(
        state,
        core,
        exerciseId,
        path,
        content
      );
      return {
        workspace: written.workspace,
        nodeId: written.nodeId,
        path: path,
        created: !!written.created,
      };
    }
    const ex = state.exercises[exerciseId];
    const existing = revision.findNodeByPath(ex.nodes, path);
    if (!existing) {
      throw Object.assign(new Error("Practice file not found."), {
        status: 404,
      });
    }
    const written = core.writeFile(state, {
      exerciseId: exerciseId,
      nodeId: existing.id,
      content: content,
    });
    return {
      workspace: core.normalizeWorkspace(written.workspace),
      nodeId: existing.id,
      path: path,
      created: false,
    };
  }

  // Back-compat name used by older tests/callers.
  function applyNextStepReadme(workspace, opts) {
    return applyRevisedContent(workspace, opts);
  }

  const REPLY_SCHEMA = {
    type: "object",
    properties: {
      feedback: { type: "string" },
      summary: { type: "string" },
      revisedContent: { type: "string" },
      nextPrompt: { type: "string" },
      zpd: {
        type: "object",
        properties: {
          unaided: { type: "string" },
          justBeyond: { type: "string" },
        },
        required: ["unaided", "justBeyond"],
        additionalProperties: false,
      },
      level: { type: "number" },
      goalAchieved: { type: "boolean" },
      practicePath: { type: "string" },
      aggressiveness: {
        type: "object",
        properties: {
          struggle: { type: "string", enum: ["hard", "ok", "easy"] },
          action: { type: "string", enum: ["finer", "keep", "skip_ahead"] },
        },
        required: ["struggle", "action"],
        additionalProperties: false,
      },
    },
    required: [
      "feedback",
      "summary",
      "revisedContent",
      "nextPrompt",
      "zpd",
      "level",
      "goalAchieved",
      "practicePath",
      "aggressiveness",
    ],
    additionalProperties: false,
  };

  return {
    MODEL: MODEL,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    MAX_ANSWER: MAX_ANSWER,
    REPLY_SCHEMA: REPLY_SCHEMA,
    TOOL_NAME: "submit_exercise_evaluation",
    parseStepsJson: parseStepsJson,
    listSteps: listSteps,
    findCurrentStep: findCurrentStep,
    nextStepAfter: nextStepAfter,
    readmePathForStep: readmePathForStep,
    parseEvaluateReply: parseEvaluateReply,
    buildEvaluateUserMessage: buildEvaluateUserMessage,
    applyRevisedContent: applyRevisedContent,
    applyNextStepReadme: applyNextStepReadme,
    normalizeStruggle: normalizeStruggle,
    normalizeAction: normalizeAction,
  };
});
