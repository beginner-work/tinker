/* Notes folder: path mapping, Markdown front matter, sync decisions.
 * Pure logic — shared by the renderer and Node tests. No DOM, no FS.
 *
 * Each person's notepad lives at <Company>/<Person Name>.md with:
 *   ---
 *   person_id: …
 *   company_id: …
 *   updated_at: …
 *   ---
 *
 * Body text below the front matter is the exact notepad body.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerNotesFolderCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAX_SEGMENT = 80;
  var UNSAFE = /[<>:"/\\|?*\u0000-\u001f]/g;

  function sanitizePathSegment(name) {
    var raw = String(name == null ? "" : name).trim();
    if (!raw) return "Unknown";
    var cleaned = raw
      .replace(UNSAFE, "-")
      .replace(/\s+/g, " ")
      .replace(/\.+$/g, "")
      .replace(/^-+|-+$/g, "")
      .trim();
    if (!cleaned) return "Unknown";
    if (cleaned.length > MAX_SEGMENT) cleaned = cleaned.slice(0, MAX_SEGMENT).trim();
    if (/^\.+$/.test(cleaned)) return "Unknown";
    return cleaned;
  }

  function noteRelPath(companyName, personName) {
    return sanitizePathSegment(companyName) + "/" + sanitizePathSegment(personName) + ".md";
  }

  function conflictRelPath(relPath, when) {
    var base = String(relPath || "note.md");
    var stamp = conflictStamp(when || new Date());
    if (/\.md$/i.test(base)) {
      return base.replace(/\.md$/i, ".conflict-" + stamp + ".md");
    }
    return base + ".conflict-" + stamp + ".md";
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

  function serializeNote(meta) {
    var personId = String((meta && meta.personId) || "").trim();
    var companyId = String((meta && meta.companyId) || "").trim();
    var updatedAt = String((meta && meta.updatedAt) || "").trim() || new Date().toISOString();
    var body = meta && meta.body != null ? String(meta.body) : "";
    // Normalize to LF; keep body as-is otherwise (exact text matters for approval).
    body = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return (
      "---\n" +
      "person_id: " + personId + "\n" +
      "company_id: " + companyId + "\n" +
      "updated_at: " + updatedAt + "\n" +
      "---\n\n" +
      body
    );
  }

  function parseFrontMatterValue(line) {
    var idx = line.indexOf(":");
    if (idx < 0) return { key: "", value: "" };
    return {
      key: line.slice(0, idx).trim().toLowerCase(),
      value: line.slice(idx + 1).trim(),
    };
  }

  function parseNote(text) {
    var raw = String(text == null ? "" : text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var personId = "";
    var companyId = "";
    var updatedAt = "";
    var body = raw;
    if (raw.indexOf("---\n") === 0 || raw === "---") {
      var end = raw.indexOf("\n---\n", 4);
      if (end === -1 && raw.indexOf("\n---") === raw.length - 4) {
        end = raw.length - 4;
      }
      if (end >= 0) {
        var fm = raw.slice(4, end);
        var parts = fm.split("\n");
        for (var i = 0; i < parts.length; i++) {
          var parsed = parseFrontMatterValue(parts[i]);
          if (parsed.key === "person_id") personId = parsed.value;
          else if (parsed.key === "company_id") companyId = parsed.value;
          else if (parsed.key === "updated_at") updatedAt = parsed.value;
        }
        body = raw.slice(end + 5); // after \n---\n
        if (body.charAt(0) === "\n") body = body.slice(1);
      }
    }
    return {
      personId: personId,
      companyId: companyId,
      updatedAt: updatedAt,
      body: body,
    };
  }

  /** Normalize bodies for equality (LF only). Approval stays exact on server. */
  function normalizeBody(text) {
    return String(text == null ? "" : text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }

  /**
   * Decide how to reconcile app notepad vs file notepad.
   * lastSyncedBody is the last content both sides agreed on.
   * Never drop text: on fork, keep app and surface file as conflictBody.
   */
  function resolveSync(input) {
    var app = normalizeBody(input && input.appBody);
    var file = normalizeBody(input && input.fileBody);
    var last = normalizeBody(input && input.lastSyncedBody);
    var appUpdatedAt = String((input && input.appUpdatedAt) || "");
    var fileUpdatedAt = String((input && input.fileUpdatedAt) || "");

    if (app === file) {
      return { action: "noop", body: app, notice: "" };
    }
    if (file === last && app !== last) {
      return { action: "export", body: app, notice: "" };
    }
    if (app === last && file !== last) {
      return { action: "import", body: file, notice: "" };
    }
    // Both diverge from last, or last is empty/unknown and they differ.
    if (app !== last && file !== last && app !== file) {
      return {
        action: "conflict",
        body: app,
        conflictBody: file,
        notice: "Kept your Tinker version. A conflict copy was saved next to the note file.",
      };
    }
    // last empty: prefer newer updated_at when both differ; else keep app + conflict.
    if (!last && app !== file) {
      if (fileUpdatedAt && appUpdatedAt && fileUpdatedAt > appUpdatedAt) {
        return { action: "import", body: file, notice: "" };
      }
      if (fileUpdatedAt && appUpdatedAt && appUpdatedAt > fileUpdatedAt) {
        return { action: "export", body: app, notice: "" };
      }
      return {
        action: "conflict",
        body: app,
        conflictBody: file,
        notice: "Kept your Tinker version. A conflict copy was saved next to the note file.",
      };
    }
    return { action: "noop", body: app, notice: "" };
  }

  /**
   * Given current names and an existing relative path for the same person,
   * return whether the file should move and the destination path.
   */
  function resolveRename(companyName, personName, existingRelPath) {
    var next = noteRelPath(companyName, personName);
    var prev = String(existingRelPath || "").replace(/\\/g, "/");
    if (!prev || prev === next) {
      return { moved: false, from: prev || next, to: next };
    }
    return { moved: true, from: prev, to: next };
  }

  /**
   * Scan parsed file records and pick the one matching personId.
   * Prefers exact relPath match when several files share an id (stale copies).
   */
  function findFileForPerson(files, personId, preferredRelPath) {
    var id = String(personId || "").trim();
    if (!id || !Array.isArray(files)) return null;
    var matches = files.filter(function (f) {
      return f && String(f.personId || "").trim() === id;
    });
    if (!matches.length) return null;
    if (preferredRelPath) {
      var pref = matches.find(function (f) { return f.relPath === preferredRelPath; });
      if (pref) return pref;
    }
    // Prefer non-conflict copies.
    var live = matches.filter(function (f) { return !/\.conflict-/i.test(f.relPath || ""); });
    return (live[0] || matches[0]) || null;
  }

  function approvalRevokedByImport(prevStatus, prevBody, nextBody) {
    var status = String(prevStatus || "");
    if (status !== "approved" && status !== "approved_to_send" && status !== "send_failed") {
      return false;
    }
    return normalizeBody(prevBody) !== normalizeBody(nextBody);
  }

  return {
    sanitizePathSegment: sanitizePathSegment,
    noteRelPath: noteRelPath,
    conflictRelPath: conflictRelPath,
    conflictStamp: conflictStamp,
    serializeNote: serializeNote,
    parseNote: parseNote,
    normalizeBody: normalizeBody,
    resolveSync: resolveSync,
    resolveRename: resolveRename,
    findFileForPerson: findFileForPerson,
    approvalRevokedByImport: approvalRevokedByImport,
  };
});
