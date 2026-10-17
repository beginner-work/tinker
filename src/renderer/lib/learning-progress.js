/* Per-user learning level/progress toward a coding goal derived from
 * technical essays (not a fixed curriculum).
 *
 * Persists via TinkerUserData kind "learning_progress" (Postgres / Prisma).
 * Opus reconstructs goal + nextPrompt + polished practice file after each
 * technical "That's everything", picking the essay that best matches ZPD.
 * Empty / awaiting_essay until the user finishes a technical essay.
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
  const EMPTY_COPY =
    "Write a technical essay to get your first coding exercise";
  const DEFAULT_EXERCISE_ID = "from-essays";

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

  function normalizeStatus(raw) {
    const s = String(raw || "").toLowerCase();
    if (s === "done") return "done";
    if (s === "active") return "active";
    return "awaiting_essay";
  }

  function defaultProgress() {
    return {
      goalId: "",
      goalTitle: "",
      exerciseId: DEFAULT_EXERCISE_ID,
      practicePath: "",
      fileName: "",
      level: 0,
      status: "awaiting_essay",
      currentPrompt: "",
      zpd: { unaided: "", justBeyond: "" },
      sourceEssayId: null,
      sourceEssayTitle: null,
      updatedAt: null,
    };
  }

  function hasExercise(progress) {
    const p = progress || {};
    return !!(
      p.status === "active" ||
      p.status === "done" ||
      (p.goalTitle && String(p.goalTitle).trim()) ||
      (p.currentPrompt && String(p.currentPrompt).trim()) ||
      (p.practicePath && String(p.practicePath).trim())
    );
  }

  function normalizeProgress(raw) {
    const base = defaultProgress();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
    const status = normalizeStatus(raw.status);
    const zpdIn = raw.zpd && typeof raw.zpd === "object" ? raw.zpd : {};
    const goalTitle = clamp(raw.goalTitle || "", MAX_TITLE);
    const currentPrompt = clamp(raw.currentPrompt || "", MAX_PROMPT);
    const practicePath = String(raw.practicePath || "")
      .replace(/^\/+|\/+$/g, "")
      .replace(/\\/g, "/");
    // Legacy OpenAPI seed rows become awaiting_essay when they look empty of essay source.
    let nextStatus = status;
    if (
      nextStatus === "active" &&
      !goalTitle &&
      !currentPrompt &&
      !practicePath
    ) {
      nextStatus = "awaiting_essay";
    }
    // If we have a goal/prompt but status was missing, treat as active.
    if (
      nextStatus === "awaiting_essay" &&
      (goalTitle || currentPrompt || practicePath) &&
      String(raw.status || "").toLowerCase() !== "awaiting_essay"
    ) {
      nextStatus =
        String(raw.status || "").toLowerCase() === "done" ? "done" : "active";
    }
    const out = {
      goalId: clamp(raw.goalId || "", 80),
      goalTitle: goalTitle,
      exerciseId:
        clamp(raw.exerciseId || base.exerciseId, 80) || base.exerciseId,
      practicePath: practicePath,
      fileName: clamp(raw.fileName || "", 120),
      level: clampLevel(raw.level != null ? raw.level : base.level),
      status: nextStatus,
      currentPrompt: currentPrompt,
      zpd: {
        unaided: clamp(zpdIn.unaided || "", MAX_ZPD),
        justBeyond: clamp(zpdIn.justBeyond || "", MAX_ZPD),
      },
      sourceEssayId:
        typeof raw.sourceEssayId === "string" && raw.sourceEssayId.trim()
          ? clamp(raw.sourceEssayId, 80)
          : null,
      sourceEssayTitle:
        typeof raw.sourceEssayTitle === "string" && raw.sourceEssayTitle.trim()
          ? clamp(raw.sourceEssayTitle, MAX_TITLE)
          : null,
      updatedAt:
        typeof raw.updatedAt === "string" && raw.updatedAt
          ? raw.updatedAt
          : null,
    };
    if (typeof raw.essayReconstructKey === "string" && raw.essayReconstructKey) {
      out.essayReconstructKey = clamp(raw.essayReconstructKey, 120);
    }
    if (typeof raw.essayReconstructEssayId === "string" && raw.essayReconstructEssayId) {
      out.essayReconstructEssayId = clamp(raw.essayReconstructEssayId, 80);
    }
    if (typeof raw.essayReconstructAt === "string" && raw.essayReconstructAt) {
      out.essayReconstructAt = raw.essayReconstructAt;
    }
    return out;
  }

  function applyCalibration(progress, calibration) {
    const prev = normalizeProgress(progress);
    const cal = calibration && typeof calibration === "object" ? calibration : {};
    const next = normalizeProgress({
      ...prev,
      goalId:
        typeof cal.goalId === "string" && cal.goalId.trim()
          ? cal.goalId
          : prev.goalId,
      goalTitle:
        typeof cal.goalTitle === "string" && cal.goalTitle.trim()
          ? cal.goalTitle
          : prev.goalTitle,
      currentPrompt:
        typeof cal.nextPrompt === "string" && cal.nextPrompt.trim()
          ? cal.nextPrompt
          : prev.currentPrompt,
      level: cal.level != null ? cal.level : prev.level,
      status: cal.goalAchieved ? "done" : "active",
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
      sourceEssayId:
        typeof cal.sourceEssayId === "string" && cal.sourceEssayId.trim()
          ? cal.sourceEssayId
          : prev.sourceEssayId,
      sourceEssayTitle:
        typeof cal.sourceEssayTitle === "string"
          ? cal.sourceEssayTitle
          : prev.sourceEssayTitle,
      essayReconstructKey: prev.essayReconstructKey,
      essayReconstructEssayId: prev.essayReconstructEssayId,
      essayReconstructAt: prev.essayReconstructAt,
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
      goalId: clamp(options.goalId || "", 80),
      goalTitle: clamp(options.goalTitle || "", MAX_TITLE),
      currentPrompt: clamp(options.currentPrompt || "", MAX_PROMPT),
      exerciseId: prev.exerciseId || DEFAULT_EXERCISE_ID,
      practicePath: options.practicePath || "",
      fileName: options.fileName || "",
      level: 0,
      status:
        options.goalTitle || options.currentPrompt ? "active" : "awaiting_essay",
      sourceEssayId: null,
      sourceEssayTitle: null,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    KIND: KIND,
    EMPTY_COPY: EMPTY_COPY,
    DEFAULT_EXERCISE_ID: DEFAULT_EXERCISE_ID,
    defaultProgress: defaultProgress,
    normalizeProgress: normalizeProgress,
    applyCalibration: applyCalibration,
    startNextGoal: startNextGoal,
    hasExercise: hasExercise,
    clampLevel: clampLevel,
  };
});
