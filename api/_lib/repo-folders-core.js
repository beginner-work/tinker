/* Pure helpers for /repo folders: content types, paths, tree rules.
 *
 * Shared by the server store and Node tests. No I/O.
 */

"use strict";

const CONTENT_TYPES = Object.freeze([
  "reflections",
  "stories",
  "exercises",
  "readings",
  "drafts",
]);

const DEFAULT_CONTENT_TYPE = "stories";
const MAX_NAME = 80;
const MAX_FOLDERS = 200;

function fail(status, message, extra) {
  const err = Object.assign(new Error(message), { status });
  if (extra && typeof extra === "object") Object.assign(err, extra);
  return err;
}

function normalizeContentType(value, fallback) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (CONTENT_TYPES.includes(raw)) return raw;
  if (fallback && CONTENT_TYPES.includes(fallback)) return fallback;
  return DEFAULT_CONTENT_TYPE;
}

function normalizeName(value) {
  const name = String(value == null ? "" : value).trim().replace(/\s+/g, " ");
  if (!name) throw fail(400, "Folder name is required.");
  if (name.length > MAX_NAME) throw fail(400, "Folder name is too long.");
  if (/[\\/]/.test(name)) throw fail(400, "Folder name cannot contain slashes.");
  return name;
}

/** Safe single path segment for disk (keeps readability). */
function pathSegment(name) {
  const raw = String(name == null ? "" : name).trim();
  const cleaned = raw
    .replace(/[\\/]/g, "-")
    .replace(/^\.+/, "")
    .replace(/[<>:"|?*\u0000-\u001f]/g, "")
    .trim();
  return cleaned || "folder";
}

function folderById(folders, id) {
  if (!id) return null;
  const list = Array.isArray(folders) ? folders : [];
  return list.find((row) => row && row.id === id) || null;
}

function childFolders(folders, parentId) {
  const pid = parentId == null || parentId === "" ? null : String(parentId);
  return (Array.isArray(folders) ? folders : []).filter((row) => {
    if (!row) return false;
    const rowParent = row.parentId == null || row.parentId === "" ? null : String(row.parentId);
    return rowParent === pid;
  });
}

function assertNoDuplicateName(folders, parentId, name, excludeId) {
  const want = String(name).toLowerCase();
  const clash = childFolders(folders, parentId).find((row) => {
    if (excludeId && row.id === excludeId) return false;
    return String(row.name || "").toLowerCase() === want;
  });
  if (clash) throw fail(409, "A folder with that name already exists here.", { code: "duplicate_name" });
}

function ancestors(folders, folderId) {
  const out = [];
  let cur = folderById(folders, folderId);
  const seen = new Set();
  while (cur) {
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    out.push(cur);
    cur = cur.parentId ? folderById(folders, cur.parentId) : null;
  }
  return out;
}

function folderPathSegments(folders, folderId) {
  return ancestors(folders, folderId).reverse().map((f) => pathSegment(f.name));
}

function folderRelDir(folders, folderId) {
  const segs = folderPathSegments(folders, folderId);
  if (!segs.length) return "stories";
  return ["stories"].concat(segs).join("/");
}

function fileRelPath(folders, folderId, fileName) {
  const base = String(fileName || "").replace(/^.*[\\/]/, "");
  if (!base) throw fail(400, "fileName is required.");
  return folderRelDir(folders, folderId) + "/" + base;
}

function isDescendant(folders, folderId, maybeAncestorId) {
  if (!folderId || !maybeAncestorId) return false;
  if (folderId === maybeAncestorId) return true;
  return ancestors(folders, folderId).some((f) => f.id === maybeAncestorId);
}

function effectiveContentType(folders, placements, fileId) {
  const map = placements && typeof placements === "object" ? placements : {};
  const folderId = map[fileId] || null;
  if (!folderId) return DEFAULT_CONTENT_TYPE;
  const folder = folderById(folders, folderId);
  if (!folder) return DEFAULT_CONTENT_TYPE;
  return normalizeContentType(folder.contentType, DEFAULT_CONTENT_TYPE);
}

function resolveCreateContentType(folders, parentId, requested) {
  const parent = parentId ? folderById(folders, parentId) : null;
  if (parentId && !parent) throw fail(404, "Parent folder not found.");
  if (parent) {
    const parentType = normalizeContentType(parent.contentType, DEFAULT_CONTENT_TYPE);
    if (requested != null && String(requested).trim() !== "") {
      const want = normalizeContentType(requested, parentType);
      if (want !== parentType) {
        throw fail(400, "Nested folders must use the parent folder's content type.", {
          code: "nested_type_locked",
        });
      }
    }
    return parentType;
  }
  return normalizeContentType(requested, DEFAULT_CONTENT_TYPE);
}

function contentTypeLabel(type) {
  const t = normalizeContentType(type, DEFAULT_CONTENT_TYPE);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function sortFolders(folders) {
  return (Array.isArray(folders) ? folders.slice() : []).sort((a, b) => {
    return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
  });
}

function buildTree(folders, parentId) {
  return sortFolders(childFolders(folders, parentId)).map((folder) => ({
    folder,
    children: buildTree(folders, folder.id),
  }));
}

function collectDescendantFolderIds(folders, folderId) {
  const out = [];
  const queue = [folderId];
  while (queue.length) {
    const id = queue.shift();
    childFolders(folders, id).forEach((child) => {
      out.push(child.id);
      queue.push(child.id);
    });
  }
  return out;
}

function filesInFolders(placements, folderIds) {
  const set = new Set(folderIds);
  const map = placements && typeof placements === "object" ? placements : {};
  return Object.keys(map).filter((fileId) => set.has(map[fileId]));
}

function folderHasContents(folders, placements, folderId) {
  if (childFolders(folders, folderId).length) return true;
  const map = placements && typeof placements === "object" ? placements : {};
  return Object.keys(map).some((fileId) => map[fileId] === folderId);
}

module.exports = {
  CONTENT_TYPES,
  DEFAULT_CONTENT_TYPE,
  MAX_NAME,
  MAX_FOLDERS,
  fail,
  normalizeContentType,
  normalizeName,
  pathSegment,
  folderById,
  childFolders,
  assertNoDuplicateName,
  ancestors,
  folderPathSegments,
  folderRelDir,
  fileRelPath,
  isDescendant,
  effectiveContentType,
  resolveCreateContentType,
  contentTypeLabel,
  sortFolders,
  buildTree,
  collectDescendantFolderIds,
  filesInFolders,
  folderHasContents,
};
