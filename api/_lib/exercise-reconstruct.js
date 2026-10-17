/* Server: reconstruct learning_progress + practice file from a technical essay.
 *
 * Idempotent per essay revision key. Persists learning_progress and writes
 * the starting practice file into the exercise workspace (Postgres).
 */

"use strict";

const { callAnthropic } = require("./anthropic.js");
const prisma = require("./db.js");
const progressApi = require("../../src/renderer/lib/learning-progress.js");
const reconstructApi = require("../../src/renderer/lib/exercise-reconstruct.js");
const store = require("./exercise-workspace-store.js");

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
  const exerciseId = progress.exerciseId || "api-design";
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

/**
 * @param {object} args
 * @param {string} args.userId
 * @param {string} args.essayId
 * @param {string} args.essayBody
 * @param {string|number} [args.essayUpdatedAt]
 * @param {function} [args.callAnthropic]
 * @param {boolean} [args.force]
 */
async function reconstructLearningFromEssay(args) {
  const userId = String((args && args.userId) || "").trim();
  if (!userId) {
    throw Object.assign(new Error("userId required"), { status: 401 });
  }
  const essayId = String((args && args.essayId) || "").trim();
  const essayBody = String((args && args.essayBody) || "");
  if (!essayId || !essayBody.trim()) {
    throw Object.assign(new Error("essayId and essayBody are required."), {
      status: 400,
    });
  }
  const key = reconstructApi.revisionKey(
    essayId,
    essayBody,
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
  const out = await reconstructApi.reconstructFromEssay({
    essayBody,
    progress: current,
    callFn: call,
  });
  const calibration = out.calibration;
  const next = progressApi.applyCalibration(current, calibration);
  next.essayReconstructKey = key;
  next.essayReconstructEssayId = essayId;
  next.essayReconstructAt = new Date().toISOString();
  // Preserve goal explicitly.
  next.goalId = current.goalId;
  next.goalTitle = current.goalTitle;

  await writeProgress(userId, next);
  let fileWrite = null;
  try {
    fileWrite = await writePracticeFile(
      userId,
      next,
      calibration.startingPracticeFile || calibration.revisedContent || ""
    );
  } catch (err) {
    // Progress is the source of truth for next open; file write is best-effort
    // when the practice path is new and writePathContent already created it.
    if (err && err.status && err.status < 500) {
      fileWrite = { error: err.message || "file_write_failed" };
    } else {
      throw err;
    }
  }

  return {
    ok: true,
    skipped: false,
    essayReconstructKey: key,
    progress: next,
    calibration: calibration,
    fileWrite: fileWrite,
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
