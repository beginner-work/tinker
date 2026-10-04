/* Storage path mapping: folder tree -> relative Markdown paths, slugs,
 * conflict names. Pure logic for Node tests and the browser UMD build.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerStoragePathCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAX_SLUG = 60;
  var UNSAFE = /[<>:"/\\|?*\u0000-\u001f]/g;

  function sanitizeSegment(name) {
    var raw = String(name == null ? "" : name).trim();
    if (!raw) return "untitled";
    var cleaned = raw
      .replace(UNSAFE, "-")
      .replace(/\s+/g, " ")
      .replace(/\.+$/g, "")
      .replace(/^-+|-+$/g, "")
      .trim();
    if (!cleaned) return "untitled";
    if (cleaned.length > 80) cleaned = cleaned.slice(0, 80).trim();
    if (/^\.+$/.test(cleaned)) return "untitled";
    return cleaned;
  }

  function slugify(title) {
    var raw = String(title == null ? "" : title).trim().toLowerCase();
    var slug = raw
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!slug) return "untitled";
    if (slug.length > MAX_SLUG) slug = slug.slice(0, MAX_SLUG).replace(/-+$/g, "");
    return slug || "untitled";
  }

  function conflictStamp(when) {
    var d = when instanceof Date ? when : new Date(when);
    if (isNaN(d.getTime())) d = new Date();
    function pad(n) { return n < 10 ? "0" + n : String(n); }
    return (
      d.getUTCFullYear() +
      pad(d.getUTCMonth() + 1) +
      pad(d.getUTCDate()) +
      "-" +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds())
    );
  }

  function conflictRelPath(relPath, when) {
    var base = String(relPath || "note.md");
    var stamp = conflictStamp(when || new Date());
    if (/\.md$/i.test(base)) {
      return base.replace(/\.md$/i, ".conflict-" + stamp + ".md");
    }
    return base + ".conflict-" + stamp + ".md";
  }

  function uniqueFileName(baseName, used) {
    var want = String(baseName || "untitled.md");
    if (!/\.md$/i.test(want)) want += ".md";
    var taken = used && typeof used === "object" ? used : {};
    if (!taken[want]) return want;
    var stem = want.replace(/\.md$/i, "");
    var n = 2;
    while (taken[stem + "-" + n + ".md"]) n += 1;
    return stem + "-" + n + ".md";
  }

  /**
   * Map a repo folder tree + file into a relative Markdown path under Tinker.
   * folders: [{id,name,parentId}], placements: {fileId: folderId},
   * file: {id, title|fileName}.
   */
  function fileRelPath(folders, placements, file) {
    var list = Array.isArray(folders) ? folders : [];
    var map = placements && typeof placements === "object" ? placements : {};
    var fileId = file && file.id != null ? String(file.id) : "";
    var folderId = map[fileId] || (file && file.folderId) || null;
    var segs = [];
    var cur = folderId
      ? list.find(function (row) { return row && row.id === folderId; })
      : null;
    var seen = {};
    while (cur) {
      if (seen[cur.id]) break;
      seen[cur.id] = true;
      segs.unshift(sanitizeSegment(cur.name));
      cur = cur.parentId
        ? list.find(function (row) { return row && row.id === cur.parentId; })
        : null;
    }
    var fileName = "";
    if (file && file.fileName) {
      fileName = String(file.fileName).replace(/^.*[\\/]/, "");
    } else if (file && file.title) {
      fileName = slugify(file.title) + ".md";
    } else if (fileId) {
      fileName = slugify(fileId) + ".md";
    } else {
      fileName = "untitled.md";
    }
    if (!/\.md$/i.test(fileName)) fileName += ".md";
    if (!segs.length) return fileName;
    return segs.join("/") + "/" + fileName;
  }

  /**
   * Expand folder tree + files into flat { relPath, tinkerId, text } rows.
   */
  function mapTreeToFiles(folders, placements, files) {
    var used = {};
    var out = [];
    (Array.isArray(files) ? files : []).forEach(function (file) {
      if (!file || !file.id) return;
      var rel = fileRelPath(folders, placements, file);
      var base = rel.split("/").pop();
      var dir = rel.indexOf("/") >= 0 ? rel.slice(0, rel.lastIndexOf("/")) : "";
      var unique = uniqueFileName(base, used);
      used[unique] = true;
      var finalRel = dir ? dir + "/" + unique : unique;
      out.push({
        relPath: finalRel,
        tinkerId: String(file.id),
        text: file.text != null ? String(file.text) : (file.body != null ? String(file.body) : ""),
        title: file.title != null ? String(file.title) : "",
      });
    });
    return out;
  }

  return {
    sanitizeSegment: sanitizeSegment,
    slugify: slugify,
    conflictStamp: conflictStamp,
    conflictRelPath: conflictRelPath,
    uniqueFileName: uniqueFileName,
    fileRelPath: fileRelPath,
    mapTreeToFiles: mapTreeToFiles,
  };
});
