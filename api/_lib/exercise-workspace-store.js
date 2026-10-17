/* Per-owner exercise workspace blob (TinkerUserData kind "exercise_workspace").
 *
 * Seed/template prefers Vercel Blob (Tinker source of truth) when
 * BLOB_READ_WRITE_TOKEN is set; otherwise falls back to the checked-in
 * lindowlabs snapshot JSON. Owner trees persist in TinkerUserData and are
 * never overwritten by seed merge. On list/sync we prune retired curriculum
 * (Formation, deleted labs, api-design extras) from the saved blob and
 * replace rides or Merchant/Order api-design trees with the current
 * PaymentIntent seed; essays and other TinkerUserData kinds are untouched.
 *
 * Essay revisions ("This is everything") and file writes also sync the
 * affected exercise into Blob when configured. Tinker has no GitHub
 * commit/push path for tlindow/lindowlabs (desktop only clones/pulls for
 * Open in IDE).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const core = require("../../src/renderer/lib/exercise-workspace-core.js");
const revision = require("../../src/renderer/lib/exercise-revision.js");
const revise = require("./exercise-revise.js");
const exerciseBlob = require("./exercise-blob.js");

const KIND = "exercise_workspace";
const UNAVAILABLE = "Exercise workspace is unavailable right now.";

let cachedSeed = null;
let cachedManifest = null;
let cachedSeedSource = null;

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

function loadLocalSeedJson() {
  const file = path.join(__dirname, "seeds", "exercise-workspace-seed.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function loadSeedJson() {
  if (cachedSeed) return cachedSeed;
  if (exerciseBlob.blobConfigured()) {
    try {
      const fromBlob = await exerciseBlob.readSeedWorkspace();
      if (fromBlob && fromBlob.exercises && Object.keys(fromBlob.exercises).length) {
        cachedSeed = fromBlob;
        cachedSeedSource = "blob";
        return cachedSeed;
      }
    } catch (err) {
      // Fall through to checked-in seed when Blob is unreachable.
      cachedSeedSource = "local_fallback";
    }
  }
  cachedSeed = exerciseBlob.sanitizeSeed(loadLocalSeedJson());
  if (!cachedSeedSource) cachedSeedSource = "local";
  return cachedSeed;
}

function loadManifestModules() {
  if (cachedManifest) return cachedManifest;
  // Renderer manifest is CommonJS/UMD compatible.
  const mod = require("../../src/renderer/exercises/manifest.js");
  cachedManifest = (mod && mod.modules) || [];
  return cachedManifest;
}

async function seedWorkspace() {
  return core.buildSeedWorkspace(await loadSeedJson(), loadManifestModules());
}

async function syncExerciseToBlob(state, exerciseId) {
  if (!exerciseBlob.blobConfigured()) return;
  const id = String(exerciseId || "").trim();
  if (!id || !state || !state.exercises || !state.exercises[id]) return;
  if (exerciseBlob.isRetiredExerciseId(id)) return;
  try {
    await exerciseBlob.upsertExerciseInSeed(id, state.exercises[id]);
    cachedSeed = null;
    cachedSeedSource = null;
  } catch (err) {
    // Blob sync must not fail the owner write path.
  }
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
    // Include a short content digest so rides→payments replacements persist
    // even when node names/structure look similar.
    const nodeSig = (ex.nodes || [])
      .map((n) => {
        const content = n.type === "file" ? String(n.content || "") : "";
        const digest = content.length + ":" + content.slice(0, 48);
        return [n.id, n.name, n.type, n.parentId || "", digest].join(":");
      })
      .sort()
      .join("|");
    parts.push(nodeSig);
  });
  return parts.join("\n");
}

async function getOrCreateMerged(userId, readOnly = false) {
  const { state, updatedAt } = await readBlob(userId);
  const seed = await seedWorkspace();
  if (!state) {
    const created = core.normalizeWorkspace(seed);
    const savedAt = readOnly ? updatedAt : await writeBlob(userId, created);
    return {
      workspace: core.presentWorkspace(created),
      updatedAt: savedAt,
      seeded: true,
      seedSource: cachedSeedSource || "local",
    };
  }
  const merged = core.mergeSeedIntoSaved(state, seed);
  const pruned = core.pruneRetiredCurriculum(merged, {
    keepIds: seed.exerciseOrder.slice(),
  });
  const refreshed = core.refreshStaleCurriculum(pruned.workspace, seed);
  const next = refreshed.workspace;
  // Persist when seed merge, name refresh, retired-curriculum prune, or
  // rides→payments refresh changed the saved blob. Idempotent: a second
  // list with a clean blob is a no-op write.
  if (!readOnly && workspaceFingerprint(state) !== workspaceFingerprint(next)) {
    const savedAt = await writeBlob(userId, next);
    return {
      workspace: core.presentWorkspace(next),
      updatedAt: savedAt,
      seeded: false,
      pruned: !!pruned.changed,
      refreshed: !!refreshed.changed,
      removedExerciseIds: pruned.removedExerciseIds,
      removedRootFolders: pruned.removedRootFolders,
      replacedExerciseIds: refreshed.replacedExerciseIds,
      seedSource: cachedSeedSource || "local",
    };
  }
  return {
    workspace: core.presentWorkspace(next),
    updatedAt,
    seeded: false,
    pruned: false,
    refreshed: false,
    removedExerciseIds: [],
    removedRootFolders: [],
    replacedExerciseIds: [],
    seedSource: cachedSeedSource || "local",
  };
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

async function listWorkspace({ userId, readOnly = false } = {}) {
  try {
    const uid = requireUserId(userId);
    return await getOrCreateMerged(uid, readOnly);
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
    const body = await mutate(args.userId, (state) => core.writeFile(state, args));
    await syncExerciseToBlob(core.normalizeWorkspace(body.workspace), args.exerciseId);
    return body;
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
    const savedAt = await writeBlob(uid, next);
    // This is everything rewrites next steps into Blob when configured.
    if (result.changed) {
      await syncExerciseToBlob(next, args.exerciseId);
    }
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

/** Write (or create) a practice file by relative path; persists workspace. */
async function writePracticePath(args) {
  try {
    const exerciseId = String((args && args.exerciseId) || "").trim();
    const practicePath = String((args && args.practicePath) || "")
      .replace(/^\/+|\/+$/g, "")
      .replace(/\\/g, "/");
    if (!exerciseId || !practicePath) {
      throw Object.assign(new Error("exerciseId and practicePath are required."), {
        status: 400,
      });
    }
    return await mutate(args.userId, (state) => {
      if (!state.exercises[exerciseId]) {
        throw Object.assign(new Error("Exercise not found."), { status: 404 });
      }
      const written = revision.writePathContent(
        state,
        core,
        exerciseId,
        practicePath,
        args.content
      );
      const next = core.normalizeWorkspace(written.workspace);
      state.exercises = next.exercises;
      state.exerciseOrder = next.exerciseOrder;
      return {
        nodeId: written.nodeId,
        created: !!written.created,
        exerciseId: exerciseId,
        practicePath: practicePath,
      };
    });
  } catch (err) {
    if (err && err.status) throw err;
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
  writePracticePath,
  reorderExercises,
  reviseFromEssay,
  // test hooks
  _resetCaches() {
    cachedSeed = null;
    cachedManifest = null;
    cachedSeedSource = null;
  },
  _seedSource() {
    return cachedSeedSource;
  },
};

