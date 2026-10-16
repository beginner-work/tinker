/* Vercel Blob storage for Tinker exercise files (source of truth).
 *
 * Layout:
 *   tinker/exercises/workspace-seed.json  — full seed workspace JSON
 *   tinker/exercises/files/<id>/<path>    — per-file copies for inspection
 *
 * Access defaults to public (matches the tinker-exercises store; curriculum
 * is already public in GitHub). Set BLOB_ACCESS=private only when the store
 * itself is private. When BLOB_READ_WRITE_TOKEN is missing, every helper
 * no-ops or returns null so callers can fall back to the checked-in seed
 * JSON. Formation and other retired curriculum ids are never written.
 */

"use strict";

const core = require("../../src/renderer/lib/exercise-workspace-core.js");

const SEED_PATHNAME = "tinker/exercises/workspace-seed.json";
const FILES_PREFIX = "tinker/exercises/files/";

function blobToken() {
  const token = String(process.env.BLOB_READ_WRITE_TOKEN || "").trim();
  return token || "";
}

function blobConfigured() {
  return !!blobToken();
}

/** Default public for the public tinker-exercises store. */
function blobAccess() {
  const raw = String(process.env.BLOB_ACCESS || "public").trim().toLowerCase();
  return raw === "private" ? "private" : "public";
}

function isRetiredExerciseId(id) {
  const key = String(id || "").trim();
  if (!key) return true;
  if (/formation/i.test(key)) return true;
  return core.RETIRED_EXERCISE_IDS.indexOf(key) !== -1;
}

function sanitizeSeed(raw) {
  const seed = raw && typeof raw === "object" ? JSON.parse(JSON.stringify(raw)) : { exercises: {} };
  const exercises = seed.exercises && typeof seed.exercises === "object" ? seed.exercises : {};
  Object.keys(exercises).forEach((id) => {
    if (isRetiredExerciseId(id)) delete exercises[id];
  });
  seed.exercises = exercises;
  if (Array.isArray(seed.exerciseOrder)) {
    seed.exerciseOrder = seed.exerciseOrder.filter((id) => !isRetiredExerciseId(id));
  }
  return seed;
}

function filePathname(exerciseId, relPath) {
  const id = String(exerciseId || "").trim();
  const rel = String(relPath || "").replace(/^\/+/, "").replace(/\\/g, "/");
  if (!id || !rel || rel.includes("..")) {
    throw Object.assign(new Error("Invalid exercise file path."), { status: 400 });
  }
  return FILES_PREFIX + id + "/" + rel;
}

function blobSdk() {
  return require("@vercel/blob");
}

async function putJson(pathname, value) {
  const token = blobToken();
  if (!token) return null;
  const { put } = blobSdk();
  const body = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return put(pathname, body, {
    access: blobAccess(),
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
  });
}

async function putText(pathname, text, contentType) {
  const token = blobToken();
  if (!token) return null;
  const { put } = blobSdk();
  return put(pathname, String(text == null ? "" : text), {
    access: blobAccess(),
    token,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: contentType || "text/plain; charset=utf-8",
  });
}

async function readJson(pathname) {
  const token = blobToken();
  if (!token) return null;
  const { get } = blobSdk();
  const result = await get(pathname, { access: blobAccess(), token });
  if (!result || !result.stream) return null;
  const chunks = [];
  for await (const chunk of result.stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readSeedWorkspace() {
  if (!blobConfigured()) return null;
  try {
    const data = await readJson(SEED_PATHNAME);
    if (!data || typeof data !== "object") return null;
    return sanitizeSeed(data);
  } catch (err) {
    if (err && (err.status === 404 || err.name === "BlobNotFoundError")) return null;
    throw err;
  }
}

function seedFileMap(seed) {
  const map = Object.create(null);
  const exercises = seed && seed.exercises && typeof seed.exercises === "object"
    ? seed.exercises
    : {};
  Object.keys(exercises).forEach((id) => {
    const ex = exercises[id];
    const nodes = Array.isArray(ex && ex.nodes) ? ex.nodes : [];
    nodes.forEach((node) => {
      if (!node || node.type !== "file" || !node.path) return;
      map[filePathname(id, node.path)] = node.content == null ? "" : String(node.content);
    });
  });
  return map;
}

function stableSeedJson(seed) {
  return JSON.stringify(seed == null ? null : seed);
}

async function writeSeedWorkspace(rawSeed) {
  if (!blobConfigured()) return { ok: false, skipped: true, reason: "missing_token" };
  const seed = sanitizeSeed(rawSeed);
  const ids = Object.keys(seed.exercises || {});
  if (ids.some((id) => /formation/i.test(id))) {
    throw Object.assign(new Error("Formation curriculum must never be stored in Blob."), {
      status: 400,
    });
  }

  let existing = null;
  try {
    existing = await readSeedWorkspace();
  } catch {
    existing = null;
  }

  const nextJson = stableSeedJson(seed);
  const prevJson = existing ? stableSeedJson(sanitizeSeed(existing)) : null;
  let seedUploaded = false;
  if (nextJson !== prevJson) {
    await putJson(SEED_PATHNAME, seed);
    seedUploaded = true;
  }

  // Mirror file contents for inspectability / per-file reads.
  // Only upload missing or changed files (compare against prior seed).
  const nextFiles = seedFileMap(seed);
  const prevFiles = existing ? seedFileMap(sanitizeSeed(existing)) : Object.create(null);
  const uploaded = [];
  const skipped = [];
  for (const pathname of Object.keys(nextFiles)) {
    if (Object.prototype.hasOwnProperty.call(prevFiles, pathname)
        && prevFiles[pathname] === nextFiles[pathname]) {
      skipped.push(pathname);
      continue;
    }
    await putText(pathname, nextFiles[pathname]);
    uploaded.push(pathname);
  }

  return {
    ok: true,
    pathname: SEED_PATHNAME,
    seedUploaded,
    files: uploaded.length,
    filesSkipped: skipped.length,
    uploadedPathnames: uploaded,
    exerciseIds: ids,
  };
}

/** Merge one exercise tree into the Blob seed (after That's everything / write_file). */
async function upsertExerciseInSeed(exerciseId, exercise) {
  if (!blobConfigured()) return { ok: false, skipped: true, reason: "missing_token" };
  const id = String(exerciseId || "").trim();
  if (!id || isRetiredExerciseId(id)) {
    return { ok: false, skipped: true, reason: "retired_or_invalid" };
  }
  const current = (await readSeedWorkspace()) || { repo: "tinker", branch: "main", exercises: {} };
  const exercises = current.exercises && typeof current.exercises === "object" ? current.exercises : {};
  const nodes = Array.isArray(exercise && exercise.nodes)
    ? exercise.nodes.map((n) => {
        if (!n) return null;
        if (n.path) {
          return {
            path: String(n.path),
            type: n.type === "folder" ? "folder" : "file",
            content: n.type === "file" ? (n.content == null ? "" : String(n.content)) : null,
          };
        }
        // Workspace nodes use id/name/parentId — convert to seed path shape when possible.
        return null;
      }).filter(Boolean)
    : [];

  // Prefer seed-shaped nodes; if caller passed workspace nodes, rebuild paths.
  let seedNodes = nodes;
  if (!seedNodes.length && exercise && Array.isArray(exercise.nodes)) {
    seedNodes = workspaceNodesToSeedPaths(exercise.nodes);
  }

  exercises[id] = {
    id,
    nodes: seedNodes,
  };
  current.exercises = exercises;
  return writeSeedWorkspace(current);
}

function workspaceNodesToSeedPaths(nodes) {
  const list = Array.isArray(nodes) ? nodes : [];
  const byId = Object.create(null);
  list.forEach((n) => {
    if (n && n.id) byId[n.id] = n;
  });
  function pathFor(node) {
    const parts = [];
    let cur = node;
    let guard = 0;
    while (cur && guard < 64) {
      parts.unshift(String(cur.name || ""));
      cur = cur.parentId ? byId[cur.parentId] : null;
      guard += 1;
    }
    return parts.filter(Boolean).join("/");
  }
  return list.map((n) => {
    if (!n) return null;
    const rel = pathFor(n);
    if (!rel) return null;
    return {
      path: rel,
      type: n.type === "folder" ? "folder" : "file",
      content: n.type === "file" ? (n.content == null ? "" : String(n.content)) : null,
    };
  }).filter(Boolean);
}

async function writeExerciseFile(exerciseId, relPath, content) {
  if (!blobConfigured()) return { ok: false, skipped: true, reason: "missing_token" };
  if (isRetiredExerciseId(exerciseId)) {
    return { ok: false, skipped: true, reason: "retired_or_invalid" };
  }
  const pathname = filePathname(exerciseId, relPath);
  await putText(pathname, content);
  return { ok: true, pathname };
}

module.exports = {
  SEED_PATHNAME,
  FILES_PREFIX,
  blobConfigured,
  blobToken,
  blobAccess,
  isRetiredExerciseId,
  sanitizeSeed,
  filePathname,
  seedFileMap,
  readSeedWorkspace,
  writeSeedWorkspace,
  upsertExerciseInSeed,
  writeExerciseFile,
  workspaceNodesToSeedPaths,
};
