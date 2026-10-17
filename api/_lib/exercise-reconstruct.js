/* Server: reconstruct learning_progress + practice file from technical essays.
 *
 * On each technical essay finish: Opus looks across all of the user's
 * technical essays, picks the ZPD-best match, and builds goal + prompt +
 * polished starting file. Idempotent per finishing-essay revision key.
 * Persists learning_progress and writes the practice file (Postgres).
 * No fixed curriculum / Blob seed drives the exercise.
 */

"use strict";

const { callAnthropic } = require("./anthropic.js");
const prisma = require("./db.js");
const progressApi = require("../../src/renderer/lib/learning-progress.js");
const reconstructApi = require("../../src/renderer/lib/exercise-reconstruct.js");
const store = require("./exercise-workspace-store.js");
const mcpContextPages = require("./mcp-context-pages.js");
const githubExercises = require("./github-exercise-repo.js");

const KIND = progressApi.KIND || "learning_progress";

async function readProgress(userId) {
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind: KIND } },
  });
  return progressApi.normalizeProgress(row && row.data);
}

async function writeProgress(userId, data) {
  const saved = await prisma.tinkerUserData.upsert({
    where: { userId_kind: { userId, kind: KIND } },
    create: { userId, kind: KIND, data },
    update: { data },
  });
  return { data, updatedAt: saved.updatedAt };
}

async function writePracticeFile(userId, progress, content) {
  const exerciseId = progress.exerciseId || progressApi.DEFAULT_EXERCISE_ID || "from-essays";
  const path = String(progress.practicePath || "").replace(/^\/+|\/+$/g, "");
  if (!path) {
    throw Object.assign(new Error("Practice path missing."), { status: 400 });
  }
  return store.writePracticePath({
    userId,
    exerciseId,
    practicePath: path,
    content: content == null ? "" : String(content),
  });
}

function normalizeIncomingEssays(args) {
  const fromList = reconstructApi.normalizeEssayList(
    (args && (args.essays || args.technicalEssays)) || []
  );
  if (fromList.length) return fromList;
  const essayId = String((args && args.essayId) || "").trim();
  const essayBody = String((args && args.essayBody) || "");
  if (essayId && essayBody.trim()) {
    return reconstructApi.normalizeEssayList([
      {
        id: essayId,
        title: (args && args.essayTitle) || "",
        body: essayBody,
        updatedAt: args && args.essayUpdatedAt,
      },
    ]);
  }
  return [];
}

/**
 * @param {object} args
 * @param {string} args.userId
 * @param {string} args.essayId finishing essay id (idempotency key base)
 * @param {string} [args.essayBody]
 * @param {string|number} [args.essayUpdatedAt]
 * @param {Array} [args.essays] all technical essays
 * @param {string} [args.technicalGoalsContext]
 * @param {function} [args.callAnthropic]
 * @param {boolean} [args.force]
 */
async function reconstructLearningFromEssay(args) {
  const userId = String((args && args.userId) || "").trim();
  if (!userId) {
    throw Object.assign(new Error("userId required"), { status: 401 });
  }
  const essayId = String((args && args.essayId) || "").trim();
  if (!essayId) {
    throw Object.assign(new Error("essayId is required."), { status: 400 });
  }
  const essays = normalizeIncomingEssays(args);
  if (!essays.length) {
    return {
      ok: true,
      skipped: true,
      reason: "no_technical_essays",
      progress: await readProgress(userId),
      emptyCopy: progressApi.EMPTY_COPY,
    };
  }
  const finishing =
    essays.find((e) => e.id === essayId) ||
    essays[0];
  const key = reconstructApi.revisionKey(
    essayId,
    finishing.body || (args && args.essayBody) || "",
    args && args.essayUpdatedAt
  );
  const current = await readProgress(userId);
  if (!args.force && reconstructApi.alreadyReconstructed(current, key)) {
    return {
      ok: true,
      skipped: true,
      reason: "already_reconstructed",
      essayReconstructKey: key,
      progress: current,
    };
  }

  const call =
    typeof args.callAnthropic === "function" ? args.callAnthropic : callAnthropic;
  let technicalGoalsContext = args && args.technicalGoalsContext;
  if (!technicalGoalsContext) {
    try {
      const prompts = await mcpContextPages.contextForPrompts(userId);
      technicalGoalsContext = prompts.technicalGoalsContext || "";
    } catch {
      technicalGoalsContext = "";
    }
  }
  const out = await reconstructApi.reconstructFromTechnicalEssays({
    essays: essays,
    progress: current,
    technicalGoalsContext: technicalGoalsContext,
    callFn: call,
  });
  const calibration = out.calibration;
  const next = progressApi.applyCalibration(current, calibration);
  next.essayReconstructKey = key;
  next.essayReconstructEssayId = essayId;
  next.essayReconstructAt = new Date().toISOString();
  next.exerciseId = next.exerciseId || progressApi.DEFAULT_EXERCISE_ID;

  await writeProgress(userId, next);
  const polished =
    calibration.startingPracticeFile || calibration.revisedContent || "";
  let fileWrite = null;
  try {
    fileWrite = await writePracticeFile(userId, next, polished);
  } catch (err) {
    if (err && err.status && err.status < 500) {
      fileWrite = { error: err.message || "file_write_failed" };
    } else {
      throw err;
    }
  }

  // Optional: publish polished goal only to GitHub (attempts stay in Tinker).
  let githubPublish = null;
  try {
    githubPublish = await githubExercises.publishPolishedGoal({
      userId,
      progress: next,
      polishedContent: polished,
      fetchImpl: args && args.fetchImpl,
    });
  } catch (err) {
    githubPublish = {
      ok: false,
      skipped: true,
      reason: (err && err.code) || "github_publish_failed",
      error: err && err.message,
    };
  }

  return {
    ok: true,
    skipped: false,
    essayReconstructKey: key,
    progress: next,
    calibration: calibration,
    fileWrite: fileWrite,
    githubPublish: githubPublish,
    mechanism: out.mechanism || null,
  };
}

module.exports = {
  KIND,
  readProgress,
  writeProgress,
  writePracticeFile,
  reconstructLearningFromEssay,
};
