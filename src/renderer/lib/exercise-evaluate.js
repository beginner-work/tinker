/* That's everything: evaluate an exercise answer and adapt the next step.
 *
 * After Tyler finishes writing in an exercise practice file, Claude Opus
 * (EXERCISE_REFACTOR / claude-opus-5-5) grades against the current step
 * goals, returns short plain-English feedback (never a full solution), and
 * proposes a rewrite of the NEXT step's README. Hidden aggressiveness dial:
 * struggle → finer steps; easy → merge/skip ahead. Formation curriculum is
 * never referenced or restored.
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

  const SYSTEM_PROMPT = [
    "You evaluate Tyler's answer in a coding exercise practice file.",
    "Compare his answer to the current step's goals only.",
    "Write short plain-English feedback: what is right, what is missing.",
    "Never give a full solution, never paste YAML or code he should type,",
    "never tell him exact lines to copy. He writes every line by feel.",
    "Never mention Formation, Formation.dev, or any retired curriculum.",
    "Never use an em dash.",
    "",
    "Hidden aggressiveness dial (do not mention the dial, scores, or labels",
    "in feedback or summary — they are internal only):",
    "- If he struggled (gaps, confusion, thin answer): rewrite the NEXT",
    "  step README with finer, smaller guided sub-steps and more scaffolding.",
    "- If he did fine: keep the next step close to its current shape,",
    "  with light targeting of remaining gaps.",
    "- If it was easy (solid, complete): merge or skip ahead — shorten the",
    "  next step, drop redundant scaffolding, or point further ahead.",
    "",
    "Rewrite only the next step's README/instructions (full file content).",
    "Keep the same step folder path. Do not invent new exercise ids.",
    "Return a single JSON object and nothing else:",
    '{ "feedback": string, "summary": string, "nextStepPath": string,',
    '  "nextStepContent": string, "aggressiveness": {',
    '    "struggle": "hard"|"ok"|"easy", "action": "finer"|"keep"|"skip_ahead"',
    "  } }",
    "feedback is 2 to 5 short sentences. summary is one short sentence about",
    "how the next step changed. nextStepContent is the full next README.",
  ].join("\n");

  function clamp(text, max) {
    const s = text == null ? "" : String(text);
    if (s.length <= max) return s;
    return s.slice(0, max);
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

  function parseEvaluateReply(text) {
    const raw = String(text || "").trim();
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
    let parsed;
    try {
      parsed = JSON.parse(candidate.slice(start, end + 1));
    } catch {
      throw Object.assign(new Error("Model reply was not valid JSON."), {
        status: 502,
      });
    }
    if (!parsed || typeof parsed.feedback !== "string" || !parsed.feedback.trim()) {
      throw Object.assign(new Error("Model reply missing feedback."), {
        status: 502,
      });
    }
    const feedback = clamp(parsed.feedback.trim(), MAX_FEEDBACK);
    if (/formation/i.test(feedback)) {
      throw Object.assign(new Error("Feedback must not mention Formation."), {
        status: 502,
      });
    }
    const nextStepPath =
      typeof parsed.nextStepPath === "string"
        ? parsed.nextStepPath.replace(/^\/+|\/+$/g, "").replace(/\\/g, "/")
        : "";
    const nextStepContent =
      typeof parsed.nextStepContent === "string" ? parsed.nextStepContent : "";
    if (nextStepPath && /formation/i.test(nextStepPath + "\n" + nextStepContent)) {
      throw Object.assign(new Error("Next step must not mention Formation."), {
        status: 502,
      });
    }
    const agg = parsed.aggressiveness && typeof parsed.aggressiveness === "object"
      ? parsed.aggressiveness
      : {};
    const struggle = normalizeStruggle(agg.struggle);
    const action = normalizeAction(agg.action, struggle);
    return {
      feedback: feedback,
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? clamp(parsed.summary.trim(), MAX_SUMMARY)
          : "Proposed next-step update",
      nextStepPath: nextStepPath,
      nextStepContent: nextStepContent,
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
    const next = options.nextStep || null;
    if (!current || !current.folder) {
      throw Object.assign(new Error("Open a file inside a curriculum step first."), {
        status: 400,
      });
    }
    const lines = [
      "Exercise id: " + String(options.exerciseId || ""),
      "Exercise name: " + String(options.exerciseName || options.exerciseId || ""),
      "Answer file: " + String(options.filePath || "file"),
      "",
      "Current step:",
      "id: " + String(current.id || ""),
      "folder: " + String(current.folder || ""),
      "title: " + String(current.title || ""),
      "goal: " + String(current.goal || ""),
      "",
      "Current step README (goals / instructions):",
      "<<<CURRENT_README",
      clamp(options.currentReadme || "", MAX_README),
      "CURRENT_README>>>",
      "",
      "Tyler's answer (evaluate this):",
      "<<<ANSWER",
      answer,
      "ANSWER>>>",
    ];
    if (next && next.folder) {
      lines.push(
        "",
        "Next step to rewrite (only this README):",
        "id: " + String(next.id || ""),
        "folder: " + String(next.folder || ""),
        "title: " + String(next.title || ""),
        "goal: " + String(next.goal || ""),
        "path: " + readmePathForStep(next),
        "",
        "Current next-step README:",
        "<<<NEXT_README",
        clamp(options.nextReadme || "", MAX_README),
        "NEXT_README>>>"
      );
    } else {
      lines.push(
        "",
        "There is no next step. Return feedback only; leave nextStepPath and",
        "nextStepContent empty strings."
      );
    }
    lines.push(
      "",
      "Remember the hidden aggressiveness dial. Never mention Formation."
    );
    return lines.join("\n");
  }

  function applyNextStepReadme(workspace, opts) {
    const options = opts || {};
    const core = options.core;
    const revision = options.revision;
    if (!core) throw new Error("exercise core required");
    if (!revision || typeof revision.writePathContent !== "function") {
      // Fallback: write via findNodeByPath + core.writeFile when writePathContent
      // is unavailable (older revision helpers still expose find + write).
      if (!revision || typeof revision.findNodeByPath !== "function") {
        throw new Error("exercise revision helper required");
      }
    }
    const exerciseId = String(options.exerciseId || "").trim();
    if (!exerciseId) {
      throw Object.assign(new Error("exerciseId is required."), { status: 400 });
    }
    const path = String(options.nextStepPath || "")
      .replace(/^\/+|\/+$/g, "")
      .replace(/\\/g, "/");
    if (!path || !/\.md$/i.test(path)) {
      throw Object.assign(new Error("Next step README path is required."), {
        status: 400,
      });
    }
    if (/formation/i.test(path)) {
      throw Object.assign(new Error("Formation curriculum must never appear."), {
        status: 400,
      });
    }
    const content = options.nextStepContent == null ? "" : String(options.nextStepContent);
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
      throw Object.assign(new Error("Next step README not found."), {
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

  return {
    MODEL: MODEL,
    SYSTEM_PROMPT: SYSTEM_PROMPT,
    MAX_ANSWER: MAX_ANSWER,
    parseStepsJson: parseStepsJson,
    listSteps: listSteps,
    findCurrentStep: findCurrentStep,
    nextStepAfter: nextStepAfter,
    readmePathForStep: readmePathForStep,
    parseEvaluateReply: parseEvaluateReply,
    buildEvaluateUserMessage: buildEvaluateUserMessage,
    applyNextStepReadme: applyNextStepReadme,
    normalizeStruggle: normalizeStruggle,
    normalizeAction: normalizeAction,
  };
});
