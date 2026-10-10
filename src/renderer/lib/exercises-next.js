/* Next unfinished exercise + resume bookmark (where the owner stopped).
 *
 * Uses manifest status + opened ids from exercises-pick. Resume bookmarks
 * are a small localStorage map written when a file opens in the explorer.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerExercisesNext = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var RESUME_KEY = "tinker.exercises.resume.v1";
  var DONE_RE = /^(done|complete|completed|finished)$/i;
  var IN_PROGRESS_RE = /in\s*progress/i;

  function readJson(storage, key, fallback) {
    try {
      var raw = storage && storage.getItem ? storage.getItem(key) : null;
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(storage, key, value) {
    try {
      if (storage && storage.setItem) storage.setItem(key, JSON.stringify(value));
    } catch (e) { /* ignore */ }
  }

  function isDoneStatus(status) {
    return DONE_RE.test(String(status || "").trim());
  }

  function isInProgressStatus(status) {
    return IN_PROGRESS_RE.test(String(status || "").trim());
  }

  function openedSet(storage, pickApi) {
    var list = [];
    if (pickApi && typeof pickApi.openedIds === "function") {
      list = pickApi.openedIds(storage);
    } else {
      list = readJson(storage || null, "tinker.exercises.opened.v1", []);
    }
    var set = Object.create(null);
    (Array.isArray(list) ? list : []).forEach(function (id) {
      set[String(id)] = true;
    });
    return set;
  }

  function resumeMap(storage) {
    var raw = readJson(storage || null, RESUME_KEY, {});
    return raw && typeof raw === "object" ? raw : {};
  }

  function getResume(moduleId, storage) {
    var id = String(moduleId || "").trim();
    if (!id) return null;
    var row = resumeMap(storage)[id];
    if (!row || typeof row !== "object") return null;
    return {
      exerciseId: id,
      nodeId: row.nodeId == null ? null : String(row.nodeId),
      fileName: row.fileName == null ? "" : String(row.fileName),
      updatedAt: row.updatedAt == null ? "" : String(row.updatedAt),
    };
  }

  function setResume(moduleId, bookmark, storage) {
    var id = String(moduleId || "").trim();
    if (!id) return null;
    var map = resumeMap(storage);
    var src = bookmark && typeof bookmark === "object" ? bookmark : {};
    map[id] = {
      nodeId: src.nodeId == null ? null : String(src.nodeId),
      fileName: src.fileName == null ? "" : String(src.fileName),
      updatedAt: src.updatedAt || new Date().toISOString(),
    };
    writeJson(storage || null, RESUME_KEY, map);
    return getResume(id, storage);
  }

  function unfinishedModules(modules, storage, pickApi) {
    var list = Array.isArray(modules) ? modules.filter(Boolean) : [];
    var opened = openedSet(storage, pickApi);
    return list.filter(function (mod) {
      if (!mod || !mod.id) return false;
      if (isDoneStatus(mod.status)) return false;
      // Manifest "Done" is authoritative; otherwise treat as unfinished.
      return true;
    }).map(function (mod) {
      var openedFlag = !!opened[String(mod.id)];
      var rank = 2;
      if (isInProgressStatus(mod.status) || openedFlag) rank = 0;
      else if (/not\s*started/i.test(String(mod.status || ""))) rank = 1;
      return { mod: mod, rank: rank, opened: openedFlag };
    }).sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return 0; // stable manifest order (filter preserves it; equal ranks keep relative order via stable sort in modern V8)
    }).map(function (row) { return row.mod; });
  }

  /**
   * Pick the signed-in owner's next unfinished exercise.
   * Prefers In progress / previously opened, then Not started, in manifest order.
   */
  function pickNextExercise(opts) {
    var options = opts || {};
    var modules = Array.isArray(options.modules) ? options.modules : [];
    var storage = options.storage;
    if (storage == null && typeof localStorage !== "undefined") storage = localStorage;
    var pickApi = options.pickApi || null;
    if (!pickApi && typeof window !== "undefined") pickApi = window.tinkerExercisesPick;
    var unfinished = unfinishedModules(modules, storage, pickApi);
    if (!unfinished.length) return null;
    var mod = unfinished[0];
    var resume = getResume(mod.id, storage);
    return {
      moduleId: String(mod.id),
      name: String(mod.name || mod.id),
      description: String(mod.description || ""),
      status: String(mod.status || ""),
      resume: resume,
      resumeLabel: resume && resume.fileName
        ? ("You left off at " + resume.fileName)
        : (isInProgressStatus(mod.status) || (resume && resume.nodeId)
          ? "Pick up where you left off"
          : "Start here"),
    };
  }

  function buildNextRepoUrl(picked, opts) {
    var options = opts || {};
    if (!picked || !picked.moduleId) return "/repo";
    var params = new URLSearchParams();
    params.set("exercise", picked.moduleId);
    if (picked.resume && picked.resume.nodeId) {
      params.set("node", picked.resume.nodeId);
    }
    if (options.lockIn) params.set("lockin", "1");
    if (options.from) params.set("from", String(options.from));
    return "/repo?" + params.toString();
  }

  return {
    RESUME_KEY: RESUME_KEY,
    isDoneStatus: isDoneStatus,
    isInProgressStatus: isInProgressStatus,
    getResume: getResume,
    setResume: setResume,
    unfinishedModules: unfinishedModules,
    pickNextExercise: pickNextExercise,
    buildNextRepoUrl: buildNextRepoUrl,
  };
});
