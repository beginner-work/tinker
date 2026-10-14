/* Per-owner exercise workspace blob (TinkerUserData kind "exercise_workspace").
 *
 * Seed/template comes from checked-in lindowlabs snapshots. Owner trees
 * persist here and are never overwritten by seed merge. On list/sync we
 * prune retired curriculum (Formation, deleted labs, api-design extras)
 * from the saved blob; essays and other TinkerUserData kinds are untouched.
 *
 * Essay revisions also land here. Tinker has no GitHub commit/push path for
 * tlindow/lindowlabs (desktop only clones/pulls for Open in IDE).
 */

"use strict";

const fs = require("fs");
const crypto = require("crypto");
const revision = require("../../src/renderer/lib/exercise-revision.js");
const path = require("path");
const core = require("../../src/renderer/lib/exercise-workspace-core.js");
const revise = require("./exercise-revise.js");

const KIND = "exercise_workspace";
const UNAVAILABLE = "Exercise workspace is unavailable right now.";

let cachedSeed = null;
let cachedManifest = null;

function db() {
  return require("./db.js");
}

function requireUserId(userId) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw core.fail(401, "Sign in to tinker first.");
  }
  return userId.trim();
}

function storeDown(err) {
  if (err && err.status) return err;
  return Object.assign(new Error(UNAVAILABLE), { status: 503, cause: err });
}

function loadSeedJson() {
  if (cachedSeed) return cachedSeed;
  const file = path.join(__dirname, "seeds", "exercise-workspace-seed.json");
  cachedSeed = JSON.parse(fs.readFileSync(file, "utf8"));
  return cachedSeed;
}

function loadManifestModules() {
  if (cachedManifest) return cachedManifest;
  // Renderer manifest is CommonJS/UMD compatible.
  const mod = require("../../src/renderer/exercises/manifest.js");
  cachedManifest = (mod && mod.modules) || [];
  return cachedManifest;
}

function seedWorkspace() {
  return core.buildSeedWorkspace(loadSeedJson(), loadManifestModules());
}

async function readBlob(userId) {
  const prisma = db();
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind: KIND } },
  });
  return {
    state: row && row.data ? core.normalizeWorkspace(row.data) : null,
    updatedAt: row ? row.updatedAt : null,
  };
}

function conflict() {
  return Object.assign(core.fail(409, "Exercise changed while revising. Reload and try again."), { code: "revision_conflict" });
}

async function writeBlob(userId, state, expectedUpdatedAt) {
  const prisma = db();
  const data = core.presentWorkspace(state);
  if (expectedUpdatedAt == null) {
    try {
      const saved = await prisma.tinkerUserData.create({ data: { userId, kind: KIND, data } });
      return saved.updatedAt;
    } catch (err) {
      if (err && err.code === "P2002") throw conflict();
      throw err;
    }
  }
  // Explicit monotonic timestamp makes even same-millisecond writes distinct.
  const updatedAt = new Date(Math.max(Date.now(), new Date(expectedUpdatedAt).getTime() + 1));
  const result = await prisma.tinkerUserData.updateMany({
    where: { userId, kind: KIND, updatedAt: expectedUpdatedAt },
    data: { data, updatedAt },
  });
  if (result.count !== 1) throw conflict();
  return updatedAt;
}

function workspaceFingerprint(state) {
  const normalized = core.normalizeWorkspace(state);
  const ids = Object.keys(normalized.exercises).sort();
  const parts = [
    normalized.exerciseOrder.join(","),
    ids.join(","),
  ];
  ids.forEach((id) => {
    const ex = normalized.exercises[id];
    parts.push(id + "=" + String(ex.name || ""));
    const nodeSig = (ex.nodes || [])
      .map((n) => [n.id, n.name, n.type, n.parentId || ""].join(":"))
      .sort()
      .join("|");
    parts.push(nodeSig);
  });
  return parts.join("\n");
}

async function getOrCreateMerged(userId) {
  const { state, updatedAt } = await readBlob(userId);
  const seed = seedWorkspace();
  if (!state) {
    const created = core.normalizeWorkspace(seed);
    const savedAt = await writeBlob(userId, created);
    return { workspace: core.presentWorkspace(created), updatedAt: savedAt, seeded: true };
  }
  const merged = core.mergeSeedIntoSaved(state, seed);
  const pruned = core.pruneRetiredCurriculum(merged, {
    keepIds: seed.exerciseOrder.slice(),
  });
  const next = pruned.workspace;
  // Persist when seed merge, name refresh, or retired-curriculum prune changed
  // the saved blob. Idempotent: a second list with a clean blob is a no-op write.
  if (workspaceFingerprint(state) !== workspaceFingerprint(next)) {
    const savedAt = await writeBlob(userId, next, updatedAt);
    return {
      workspace: core.presentWorkspace(next),
      updatedAt: savedAt,
      seeded: false,
      pruned: !!pruned.changed,
      removedExerciseIds: pruned.removedExerciseIds,
      removedRootFolders: pruned.removedRootFolders,
    };
  }
  return {
    workspace: core.presentWorkspace(next),
    updatedAt,
    seeded: false,
    pruned: false,
    removedExerciseIds: [],
    removedRootFolders: [],
  };
}

async function mutate(userId, mutator) {
  const uid = requireUserId(userId);
  const current = await getOrCreateMerged(uid);
  const state = core.normalizeWorkspace(current.workspace);
  const result = mutator(state);
  const savedAt = await writeBlob(uid, state, current.updatedAt);
  const body = Object.assign({}, result, {
    workspace: core.presentWorkspace(state),
    updatedAt: savedAt,
  });
  return body;
}

async function listWorkspace({ userId } = {}) {
  try {
    const uid = requireUserId(userId);
    return await getOrCreateMerged(uid);
  } catch (err) {
    throw storeDown(err);
  }
}

async function syncWorkspace({ userId } = {}) {
  // Explicit sync = same merge path as list.
  return listWorkspace({ userId });
}

async function createNode(args) {
  try {
    return await mutate(args.userId, (state) => core.createNode(state, args));
  } catch (err) {
    throw storeDown(err);
  }
}

async function renameNode(args) {
  try {
    return await mutate(args.userId, (state) => core.renameNode(state, args));
  } catch (err) {
    throw storeDown(err);
  }
}

async function moveNode(args) {
  try {
    return await mutate(args.userId, (state) => core.moveNode(state, args));
  } catch (err) {
    throw storeDown(err);
  }
}

async function deleteNode(args) {
  try {
    return await mutate(args.userId, (state) => core.deleteNode(state, args));
  } catch (err) {
    throw storeDown(err);
  }
}

async function writeFile(args) {
  try {
    return await mutate(args.userId, (state) => core.writeFile(state, args));
  } catch (err) {
    throw storeDown(err);
  }
}

async function reorderExercises(args) {
  try {
    return await mutate(args.userId, (state) => core.reorderExercises(state, args));
  } catch (err) {
    throw storeDown(err);
  }
}

async function reviseFromEssay(args) {
  try {
    const uid = requireUserId(args.userId);
    const current = await getOrCreateMerged(uid);
    const state = core.normalizeWorkspace(current.workspace);
    const result = await revise.reviseExerciseWithClaude({
      workspace: state,
      exerciseId: args.exerciseId,
      essayBody: args.essayBody,
      core: core,
      callAnthropic: args.callAnthropic,
      model: args.model,
      maxTokens: args.maxTokens,
    });
    const next = core.normalizeWorkspace(result.workspace);
    const savedAt = await writeBlob(uid, next, current.updatedAt);
    return {
      workspace: core.presentWorkspace(next),
      updatedAt: savedAt,
      steps: result.steps || [],
      filesUpdated: result.filesUpdated || [],
      changed: !!result.changed,
      readmeNodeId: result.readmeNodeId || null,
      usage: result.usage || null,
    };
  } catch (err) {
    if (err && err.status) throw err;
    throw storeDown(err);
  }
}

function selectedExercise(state, exerciseId) {
  if (typeof exerciseId !== "string" || !exerciseId.trim() || exerciseId !== exerciseId.trim()) {
    throw core.fail(400, "exerciseId is required.");
  }
  if (!Object.prototype.hasOwnProperty.call(state.exercises, exerciseId)) {
    throw core.fail(404, "Exercise not found.");
  }
  return state.exercises[exerciseId];
}

function baseFingerprint(exercise, essayBody) {
  return crypto.createHash("sha256").update(JSON.stringify({ exercise, essayBody })).digest("hex");
}

function validateRevision(value) {
  const exactKeys = (obj, keys) => obj && typeof obj === "object" && !Array.isArray(obj)
    && Object.keys(obj).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(obj, key));
  if (!exactKeys(value, ["steps", "files"]) || !Array.isArray(value.steps) || !Array.isArray(value.files)
    || value.steps.length > 50 || value.files.length > 24 || (!value.steps.length && !value.files.length)) {
    throw core.fail(400, "Invalid revision schema or size.");
  }
  if (value.steps.some(step => typeof step !== "string" || !step.trim() || step.length > 2000)) {
    throw core.fail(400, "Invalid revision steps.");
  }
  const seen = new Set();
  let total = 0;
  for (const file of value.files) {
    if (!exactKeys(file, ["path", "content"]) || typeof file.path !== "string" || typeof file.content !== "string"
      || file.content.length > core.MAX_CONTENT_CHARS) throw core.fail(400, "Invalid revision file.");
    const parts = file.path.split("/");
    if (!file.path || file.path.length > 1024 || /[\\:\x00-\x1f\x7f]/.test(file.path)
      || file.path.includes("..") || parts.length > 16
      || parts.some(part => !part || part === "." || part !== part.trim() || part.length > 120)
      || seen.has(file.path.toLowerCase())) throw core.fail(400, "Invalid or duplicate file path.");
    if (/(^|\/)(fixtures?|__fixtures__|testdata)(\/|$)/i.test(file.path)) {
      throw core.fail(400, "Fixture revisions are not supported.");
    }
    seen.add(file.path.toLowerCase());
    total += file.content.length;
  }
  if (total > 500000) throw core.fail(400, "Revision is too large.");
  return value;
}

async function prepareRevision(args = {}) {
  try {
    const uid = requireUserId(args.userId);
    const essayBody = revise.readEssay(args.essayBody);
    const current = await getOrCreateMerged(uid);
    const state = core.normalizeWorkspace(current.workspace);
    const ex = selectedExercise(state, args.exerciseId);
    const files = revision.listExerciseFiles(ex.nodes, { maxFiles: Infinity, maxChars: Infinity });
    if (files.length > 40 || files.some(file => file.content.length > 14000)) {
      throw core.fail(400, "Exercise context is too large for a revision. Shorten the exercise files and try again.");
    }
    const context = {
      exerciseId: ex.id,
      exerciseName: ex.name,
      essayBody,
      files,
      baseFingerprint: baseFingerprint(ex, essayBody),
      updatedAt: current.updatedAt,
    };
    if (Buffer.byteLength(JSON.stringify(context), "utf8") > 400000) {
      throw core.fail(400, "Exercise context is too large for a revision.");
    }
    return context;
  } catch (err) { throw storeDown(err); }
}

async function applyRevision(args = {}) {
  try {
    const uid = requireUserId(args.userId);
    const essayBody = revise.readEssay(args.essayBody);
    const patch = validateRevision(args.revision);
    if (typeof args.baseFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(args.baseFingerprint)) {
      throw core.fail(400, "baseFingerprint is required.");
    }
    // Read the owner blob directly: applying generated output must never seed,
    // prune, or accept a renderer's replacement of the workspace.
    const current = await readBlob(uid);
    if (!current.state) throw conflict();
    const ex = selectedExercise(current.state, args.exerciseId);
    if (baseFingerprint(ex, essayBody) !== args.baseFingerprint) throw conflict();
    const applied = revision.applyClaudeRevision(current.state, {
      core, exerciseId: args.exerciseId, essayBody, steps: patch.steps, files: patch.files,
    });
    const next = core.normalizeWorkspace(current.state);
    next.exercises[args.exerciseId] = core.normalizeWorkspace(applied.workspace).exercises[args.exerciseId];
    const updatedAt = await writeBlob(uid, next, current.updatedAt);
    return Object.assign({}, applied, { workspace: core.presentWorkspace(next), updatedAt });
  } catch (err) { throw storeDown(err); }
}

module.exports = {
  KIND,
  seedWorkspace,
  listWorkspace,
  syncWorkspace,
  createNode,
  renameNode,
  moveNode,
  deleteNode,
  writeFile,
  reorderExercises,
  reviseFromEssay,
  prepareRevision,
  applyRevision,
  // test hooks
  _resetCaches() {
    cachedSeed = null;
    cachedManifest = null;
  },
};

