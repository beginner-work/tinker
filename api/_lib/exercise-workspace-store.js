/* Per-owner exercise workspace blob (TinkerUserData kind "exercise_workspace").
 *
 * Seed/template comes from checked-in lindowlabs snapshots. Owner trees
 * persist here and are never overwritten by seed merge.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const core = require("../../src/renderer/lib/exercise-workspace-core.js");

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

async function writeBlob(userId, state) {
  const prisma = db();
  const data = core.presentWorkspace(state);
  const saved = await prisma.tinkerUserData.upsert({
    where: { userId_kind: { userId, kind: KIND } },
    create: { userId, kind: KIND, data },
    update: { data },
  });
  return saved.updatedAt;
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
  // Persist merge only when new exercises were added.
  const beforeIds = Object.keys(state.exercises).sort().join(",");
  const afterIds = Object.keys(merged.exercises).sort().join(",");
  if (beforeIds !== afterIds || state.exerciseOrder.join(",") !== merged.exerciseOrder.join(",")) {
    // Only persist if structure keys changed (new exercises). Name-only
    // refreshes also persist so labels stay current.
    const savedAt = await writeBlob(userId, merged);
    return { workspace: core.presentWorkspace(merged), updatedAt: savedAt, seeded: false };
  }
  // Name refresh in memory without forcing write when order+ids identical
  // but names differ — still write if names changed.
  let namesChanged = false;
  Object.keys(merged.exercises).forEach((id) => {
    if ((state.exercises[id] && state.exercises[id].name) !== merged.exercises[id].name) {
      namesChanged = true;
    }
  });
  if (namesChanged) {
    const savedAt = await writeBlob(userId, merged);
    return { workspace: core.presentWorkspace(merged), updatedAt: savedAt, seeded: false };
  }
  return { workspace: core.presentWorkspace(merged), updatedAt, seeded: false };
}

async function mutate(userId, mutator) {
  const uid = requireUserId(userId);
  const current = await getOrCreateMerged(uid);
  const state = core.normalizeWorkspace(current.workspace);
  const result = mutator(state);
  const savedAt = await writeBlob(uid, state);
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
  // test hooks
  _resetCaches() {
    cachedSeed = null;
    cachedManifest = null;
  },
};
