/* Per-user learning level/progress toward a single coding goal.
 *
 * Persists via TinkerUserData kind "learning_progress" (Postgres / Prisma).
 * The agent calibrates level + nextPrompt against ZPD after each
 * "That's everything"; never asks "where do you start?" — starting
 * prompt is seeded from the OpenAPI-from-scratch goal (plain English
 * first). Formation curriculum is never referenced.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.tinkerLearningProgress = api;
  } else if (root) {
    root.tinkerLearningProgress = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const KIND = "learning_progress";
  const DEFAULT_GOAL_ID = "openapi-from-scratch";
  const DEFAULT_GOAL_TITLE =
    "Write an OpenAPI spec from scratch by feel, no copy-paste";
  const DEFAULT_EXERCISE_ID = "api-design";
  const DEFAULT_PRACTICE_PATH = "00-in-plain-english/api.md";
  const DEFAULT_FILE_NAME = "api.md";
  const DEFAULT_PROMPT =
    "In plain English, describe what a caller can ask for, send, get back, and what can go wrong for a PaymentIntent. Pseudocode is fine.";

  const MAX_PROMPT = 600;
  const MAX_ZPD = 400;
  const MAX_TITLE = 200;

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

  function defaultProgress() {
    return {
      goalId: DEFAULT_GOAL_ID,
      goalTitle: DEFAULT_GOAL_TITLE,
      exerciseId: DEFAULT_EXERCISE_ID,
      practicePath: DEFAULT_PRACTICE_PATH,
      fileName: DEFAULT_FILE_NAME,
      level: 0,
      status: "active",
      currentPrompt: DEFAULT_PROMPT,
      zpd: { unaided: "", justBeyond: "" },
      updatedAt: null,
    };
  }

  function normalizeProgress(raw) {
    const base = defaultProgress();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
    const status =
      String(raw.status || "").toLowerCase() === "done" ? "done" : "active";
    const zpdIn = raw.zpd && typeof raw.zpd === "object" ? raw.zpd : {};
    return {
      goalId: clamp(raw.goalId || base.goalId, 80) || base.goalId,
      goalTitle: clamp(raw.goalTitle || base.goalTitle, MAX_TITLE) || base.goalTitle,
      exerciseId:
        clamp(raw.exerciseId || base.exerciseId, 80) || base.exerciseId,
      practicePath: String(raw.practicePath || base.practicePath)
        .replace(/^\/+|\/+$/g, "")
        .replace(/\\/g, "/") || base.practicePath,
      fileName: clamp(raw.fileName || base.fileName, 120) || base.fileName,
      level: clampLevel(raw.level != null ? raw.level : base.level),
      status: status,
      currentPrompt:
        clamp(raw.currentPrompt || base.currentPrompt, MAX_PROMPT) ||
        base.currentPrompt,
      zpd: {
        unaided: clamp(zpdIn.unaided || "", MAX_ZPD),
        justBeyond: clamp(zpdIn.justBeyond || "", MAX_ZPD),
      },
      updatedAt:
        typeof raw.updatedAt === "string" && raw.updatedAt
          ? raw.updatedAt
          : null,
    };
  }

  function applyCalibration(progress, calibration) {
    const prev = normalizeProgress(progress);
    const cal = calibration && typeof calibration === "object" ? calibration : {};
    const next = normalizeProgress({
      ...prev,
      currentPrompt:
        typeof cal.nextPrompt === "string" && cal.nextPrompt.trim()
          ? cal.nextPrompt
          : prev.currentPrompt,
      level: cal.level != null ? cal.level : prev.level,
      status: cal.goalAchieved ? "done" : prev.status,
      practicePath:
        typeof cal.practicePath === "string" && cal.practicePath.trim()
          ? cal.practicePath
          : prev.practicePath,
      fileName:
        typeof cal.fileName === "string" && cal.fileName.trim()
          ? cal.fileName
          : prev.fileName,
      zpd: {
        unaided:
          cal.zpd && typeof cal.zpd.unaided === "string"
            ? cal.zpd.unaided
            : prev.zpd.unaided,
        justBeyond:
          cal.zpd && typeof cal.zpd.justBeyond === "string"
            ? cal.zpd.justBeyond
            : prev.zpd.justBeyond,
      },
      updatedAt: new Date().toISOString(),
    });
    if (cal.goalAchieved) next.status = "done";
    return next;
  }

  function startNextGoal(progress, opts) {
    const options = opts || {};
    const prev = normalizeProgress(progress);
    return normalizeProgress({
      ...defaultProgress(),
      goalId: clamp(options.goalId || "next-goal", 80),
      goalTitle:
        clamp(options.goalTitle || "Set your next coding goal", MAX_TITLE) ||
        "Set your next coding goal",
      currentPrompt:
        clamp(
          options.currentPrompt ||
            "Name the next skill you want to write by feel, then attempt the smallest first slice here.",
          MAX_PROMPT
        ),
      exerciseId: prev.exerciseId,
      practicePath: options.practicePath || prev.practicePath,
      fileName: options.fileName || prev.fileName,
      level: 0,
      status: "active",
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    KIND: KIND,
    DEFAULT_GOAL_ID: DEFAULT_GOAL_ID,
    DEFAULT_GOAL_TITLE: DEFAULT_GOAL_TITLE,
    DEFAULT_EXERCISE_ID: DEFAULT_EXERCISE_ID,
    DEFAULT_PRACTICE_PATH: DEFAULT_PRACTICE_PATH,
    DEFAULT_PROMPT: DEFAULT_PROMPT,
    defaultProgress: defaultProgress,
    normalizeProgress: normalizeProgress,
    applyCalibration: applyCalibration,
    startNextGoal: startNextGoal,
    clampLevel: clampLevel,
  };
});
