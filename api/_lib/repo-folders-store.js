/* /repo folder tree + file placements (TinkerUserData kind "repo_folders").
 *
 * Folders are nested categories with a content type. Files (self-reflection
 * ids) inherit the type of the folder they sit in; untyped top-level files
 * are treated as stories. Writing is never deleted by folder ops.
 */

"use strict";

const crypto = require("crypto");
const core = require("./repo-folders-core.js");

const KIND = "repo_folders";
const UNAVAILABLE = "Repo folders are unavailable right now.";

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

function newFolderId() {
  return "fld_" + crypto.randomBytes(8).toString("hex");
}

function emptyState() {
  return { folders: [], placements: {} };
}

function normalizeState(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const folders = Array.isArray(data.folders)
    ? data.folders.filter((row) => row && row.id && row.name).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      parentId: row.parentId == null || row.parentId === "" ? null : String(row.parentId),
      contentType: core.normalizeContentType(row.contentType, core.DEFAULT_CONTENT_TYPE),
      createdAt: row.createdAt || "",
      updatedAt: row.updatedAt || "",
    }))
    : [];
  const placements = {};
  if (data.placements && typeof data.placements === "object") {
    Object.keys(data.placements).forEach((fileId) => {
      const folderId = data.placements[fileId];
      if (folderId == null || folderId === "") return;
      placements[String(fileId)] = String(folderId);
    });
  }
  return { folders, placements };
}

function presentFolder(folder) {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    contentType: core.normalizeContentType(folder.contentType, core.DEFAULT_CONTENT_TYPE),
    createdAt: folder.createdAt || "",
    updatedAt: folder.updatedAt || "",
  };
}

async function readBlob(userId) {
  const prisma = db();
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind: KIND } },
  });
  return {
    state: normalizeState(row && row.data),
    updatedAt: row ? row.updatedAt : null,
  };
}

async function writeBlob(userId, state) {
  const prisma = db();
  const data = {
    folders: state.folders.map(presentFolder),
    placements: state.placements,
  };
  const saved = await prisma.tinkerUserData.upsert({
    where: { userId_kind: { userId, kind: KIND } },
    create: { userId, kind: KIND, data },
    update: { data },
  });
  return saved.updatedAt;
}

function presentState(state, updatedAt) {
  const folders = state.folders.map(presentFolder);
  const placements = Object.assign({}, state.placements);
  const fileTypes = {};
  Object.keys(placements).forEach((fileId) => {
    fileTypes[fileId] = core.effectiveContentType(folders, placements, fileId);
  });
  return {
    folders,
    placements,
    fileTypes,
    defaultContentType: core.DEFAULT_CONTENT_TYPE,
    contentTypes: core.CONTENT_TYPES.slice(),
    updatedAt: updatedAt || null,
  };
}

async function getTree({ userId } = {}) {
  try {
    const uid = requireUserId(userId);
    const { state, updatedAt } = await readBlob(uid);
    return presentState(state, updatedAt);
  } catch (err) {
    throw storeDown(err);
  }
}

async function createFolder({ userId, name, parentId, contentType } = {}) {
  try {
    const uid = requireUserId(userId);
    const { state } = await readBlob(uid);
    if (state.folders.length >= core.MAX_FOLDERS) {
      throw core.fail(400, "Folder limit reached.");
    }
    const parent = parentId == null || parentId === "" ? null : String(parentId);
    if (parent && !core.folderById(state.folders, parent)) {
      throw core.fail(404, "Parent folder not found.");
    }
    const folderName = core.normalizeName(name);
    core.assertNoDuplicateName(state.folders, parent, folderName);
    const type = core.resolveCreateContentType(state.folders, parent, contentType);
    const now = new Date().toISOString();
    const folder = {
      id: newFolderId(),
      name: folderName,
      parentId: parent,
      contentType: type,
      createdAt: now,
      updatedAt: now,
    };
    state.folders.push(folder);
    const updatedAt = await writeBlob(uid, state);
    return { folder: presentFolder(folder), tree: presentState(state, updatedAt) };
  } catch (err) {
    throw storeDown(err);
  }
}

async function renameFolder({ userId, folderId, name } = {}) {
  try {
    const uid = requireUserId(userId);
    const { state } = await readBlob(uid);
    const folder = core.folderById(state.folders, folderId);
    if (!folder) throw core.fail(404, "Folder not found.");
    const folderName = core.normalizeName(name);
    core.assertNoDuplicateName(state.folders, folder.parentId, folderName, folder.id);
    folder.name = folderName;
    folder.updatedAt = new Date().toISOString();
    const updatedAt = await writeBlob(uid, state);
    return { folder: presentFolder(folder), tree: presentState(state, updatedAt) };
  } catch (err) {
    throw storeDown(err);
  }
}

async function moveFolder({ userId, folderId, parentId } = {}) {
  try {
    const uid = requireUserId(userId);
    const { state } = await readBlob(uid);
    const folder = core.folderById(state.folders, folderId);
    if (!folder) throw core.fail(404, "Folder not found.");
    const parent = parentId == null || parentId === "" ? null : String(parentId);
    if (parent === folder.id) throw core.fail(400, "A folder cannot contain itself.");
    if (parent && !core.folderById(state.folders, parent)) {
      throw core.fail(404, "Parent folder not found.");
    }
    if (parent && core.isDescendant(state.folders, parent, folder.id)) {
      throw core.fail(400, "Cannot move a folder into its descendant.");
    }
    if (parent) {
      const parentFolder = core.folderById(state.folders, parent);
      const parentType = core.normalizeContentType(parentFolder.contentType);
      const ownType = core.normalizeContentType(folder.contentType);
      if (ownType !== parentType) {
        throw core.fail(400, "Nested folders must use the parent folder's content type.", {
          code: "nested_type_locked",
        });
      }
    }
    core.assertNoDuplicateName(state.folders, parent, folder.name, folder.id);
    folder.parentId = parent;
    folder.updatedAt = new Date().toISOString();
    const updatedAt = await writeBlob(uid, state);
    return { folder: presentFolder(folder), tree: presentState(state, updatedAt) };
  } catch (err) {
    throw storeDown(err);
  }
}

/**
 * Delete a folder.
 * - Empty: deletes immediately.
 * - Non-empty without confirm: 409 folder_not_empty.
 * - confirm + !deleteContents: move child folders and files to parent, then delete.
 * - confirm + deleteContents: delete folder and descendant folders; files move to
 *   the deleted folder's parent (writing is never destroyed).
 */
async function deleteFolder({ userId, folderId, confirm, deleteContents } = {}) {
  try {
    const uid = requireUserId(userId);
    const { state } = await readBlob(uid);
    const folder = core.folderById(state.folders, folderId);
    if (!folder) throw core.fail(404, "Folder not found.");
    const hasContents = core.folderHasContents(state.folders, state.placements, folder.id);
    if (hasContents && !confirm) {
      const childFolderIds = core.collectDescendantFolderIds(state.folders, folder.id);
      const fileIds = core.filesInFolders(
        state.placements,
        [folder.id].concat(childFolderIds)
      );
      throw core.fail(409, "Folder is not empty.", {
        code: "folder_not_empty",
        fileCount: fileIds.length,
        folderCount: childFolderIds.length,
      });
    }

    const parentId = folder.parentId;
    const descendantIds = core.collectDescendantFolderIds(state.folders, folder.id);
    const removeIds = new Set(deleteContents ? [folder.id].concat(descendantIds) : [folder.id]);

    if (!deleteContents) {
      // Reparent immediate children to this folder's parent.
      state.folders.forEach((row) => {
        if (row.parentId === folder.id) row.parentId = parentId;
      });
      Object.keys(state.placements).forEach((fileId) => {
        if (state.placements[fileId] === folder.id) {
          if (parentId) state.placements[fileId] = parentId;
          else delete state.placements[fileId];
        }
      });
    } else {
      // Remove whole subtree of folders; park files on the deleted root's parent.
      Object.keys(state.placements).forEach((fileId) => {
        if (removeIds.has(state.placements[fileId])) {
          if (parentId) state.placements[fileId] = parentId;
          else delete state.placements[fileId];
        }
      });
    }

    state.folders = state.folders.filter((row) => !removeIds.has(row.id));
    const updatedAt = await writeBlob(uid, state);
    return {
      deletedId: folder.id,
      movedToParent: !deleteContents || true,
      writingPreserved: true,
      tree: presentState(state, updatedAt),
    };
  } catch (err) {
    throw storeDown(err);
  }
}

async function moveFile({ userId, fileId, folderId } = {}) {
  try {
    const uid = requireUserId(userId);
    const id = String(fileId || "").trim();
    if (!id) throw core.fail(400, "fileId is required.");
    const { state } = await readBlob(uid);
    const target = folderId == null || folderId === "" ? null : String(folderId);
    if (target && !core.folderById(state.folders, target)) {
      throw core.fail(404, "Folder not found.");
    }
    if (target) state.placements[id] = target;
    else delete state.placements[id];
    const updatedAt = await writeBlob(uid, state);
    return {
      fileId: id,
      folderId: target,
      contentType: core.effectiveContentType(state.folders, state.placements, id),
      tree: presentState(state, updatedAt),
    };
  } catch (err) {
    throw storeDown(err);
  }
}

function attachTypes(reflections, tree) {
  const folders = tree && tree.folders ? tree.folders : [];
  const placements = tree && tree.placements ? tree.placements : {};
  return (Array.isArray(reflections) ? reflections : []).map((row) => {
    const id = row && row.id != null ? String(row.id) : "";
    const folderId = placements[id] || null;
    return Object.assign({}, row, {
      folderId,
      contentType: core.effectiveContentType(folders, placements, id),
    });
  });
}

module.exports = {
  KIND,
  UNAVAILABLE,
  CONTENT_TYPES: core.CONTENT_TYPES,
  DEFAULT_CONTENT_TYPE: core.DEFAULT_CONTENT_TYPE,
  getTree,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  moveFile,
  attachTypes,
  normalizeState,
  emptyState,
  core,
};
