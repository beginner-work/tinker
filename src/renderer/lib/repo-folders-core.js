/* Browser/UMD mirror of api/_lib/repo-folders-core.js for /repo UI.
 * Keep CONTENT_TYPES and path helpers in sync with the server module.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerRepoFoldersCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CONTENT_TYPES = [
    "reflections",
    "stories",
    "exercises",
    "readings",
    "drafts",
  ];
  var DEFAULT_CONTENT_TYPE = "stories";

  function normalizeContentType(value, fallback) {
    var raw = String(value == null ? "" : value).trim().toLowerCase();
    if (CONTENT_TYPES.indexOf(raw) !== -1) return raw;
    if (fallback && CONTENT_TYPES.indexOf(fallback) !== -1) return fallback;
    return DEFAULT_CONTENT_TYPE;
  }

  function contentTypeLabel(type) {
    var t = normalizeContentType(type, DEFAULT_CONTENT_TYPE);
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function pathSegment(name) {
    var raw = String(name == null ? "" : name).trim();
    var cleaned = raw
      .replace(/[\\/]/g, "-")
      .replace(/^\.+/, "")
      .replace(/[<>:"|?*\u0000-\u001f]/g, "")
      .trim();
    return cleaned || "folder";
  }

  function folderById(folders, id) {
    if (!id) return null;
    var list = Array.isArray(folders) ? folders : [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function childFolders(folders, parentId) {
    var pid = parentId == null || parentId === "" ? null : String(parentId);
    return (Array.isArray(folders) ? folders : []).filter(function (row) {
      if (!row) return false;
      var rowParent = row.parentId == null || row.parentId === "" ? null : String(row.parentId);
      return rowParent === pid;
    });
  }

  function ancestors(folders, folderId) {
    var out = [];
    var cur = folderById(folders, folderId);
    var seen = {};
    while (cur) {
      if (seen[cur.id]) break;
      seen[cur.id] = true;
      out.push(cur);
      cur = cur.parentId ? folderById(folders, cur.parentId) : null;
    }
    return out;
  }

  function folderRelDir(folders, folderId) {
    var segs = ancestors(folders, folderId).reverse().map(function (f) {
      return pathSegment(f.name);
    });
    if (!segs.length) return "stories";
    return ["stories"].concat(segs).join("/");
  }

  function fileRelPath(folders, folderId, fileName) {
    var base = String(fileName || "").replace(/^.*[\\/]/, "");
    return folderRelDir(folders, folderId) + "/" + base;
  }

  function effectiveContentType(folders, placements, fileId) {
    var map = placements && typeof placements === "object" ? placements : {};
    var folderId = map[fileId] || null;
    if (!folderId) return DEFAULT_CONTENT_TYPE;
    var folder = folderById(folders, folderId);
    if (!folder) return DEFAULT_CONTENT_TYPE;
    return normalizeContentType(folder.contentType, DEFAULT_CONTENT_TYPE);
  }

  function sortByName(rows) {
    return (Array.isArray(rows) ? rows.slice() : []).sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""), undefined, {
        sensitivity: "base",
      });
    });
  }

  function sortFiles(files) {
    return (Array.isArray(files) ? files.slice() : []).sort(function (a, b) {
      return String(a.fileName || a.relPath || "").localeCompare(
        String(b.fileName || b.relPath || ""),
        undefined,
        { sensitivity: "base" }
      );
    });
  }

  function filesInFolder(files, placements, folderId) {
    var map = placements && typeof placements === "object" ? placements : {};
    var pid = folderId == null || folderId === "" ? null : String(folderId);
    return sortFiles(
      (Array.isArray(files) ? files : []).filter(function (file) {
        var placed = map[file.id];
        if (placed == null || placed === "") {
          placed = file && file.folderId ? file.folderId : null;
        }
        return placed === pid;
      })
    );
  }

  return {
    CONTENT_TYPES: CONTENT_TYPES,
    DEFAULT_CONTENT_TYPE: DEFAULT_CONTENT_TYPE,
    normalizeContentType: normalizeContentType,
    contentTypeLabel: contentTypeLabel,
    pathSegment: pathSegment,
    folderById: folderById,
    childFolders: childFolders,
    ancestors: ancestors,
    folderRelDir: folderRelDir,
    fileRelPath: fileRelPath,
    effectiveContentType: effectiveContentType,
    sortByName: sortByName,
    sortFiles: sortFiles,
    filesInFolder: filesInFolder,
  };
});
