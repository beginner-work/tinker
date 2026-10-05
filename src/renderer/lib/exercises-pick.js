/* Deterministic exercise recommendation for a writing session.
 *
 * Prefer a manifest module whose tags appear in the session text or place.
 * Otherwise rotate through modules the owner has not opened yet.
 * No AI and no network calls.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerExercisesPick = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var OPENED_KEY = "tinker.exercises.opened.v1";
  var ROTATE_KEY = "tinker.exercises.rotate.v1";

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

  function openedIds(storage) {
    var list = readJson(storage || null, OPENED_KEY, []);
    return Array.isArray(list) ? list.map(String) : [];
  }

  function markOpened(moduleId, storage) {
    var id = String(moduleId || "").trim();
    if (!id) return openedIds(storage);
    var list = openedIds(storage);
    if (list.indexOf(id) === -1) list.push(id);
    writeJson(storage || null, OPENED_KEY, list);
    return list;
  }

  function rotateIndex(storage) {
    var n = Number(readJson(storage || null, ROTATE_KEY, 0));
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }

  function bumpRotate(storage, modulesLength) {
    var next = (rotateIndex(storage) + 1) % Math.max(1, modulesLength || 1);
    writeJson(storage || null, ROTATE_KEY, next);
    return next;
  }

  function normalizeHaystack(parts) {
    return parts
      .map(function (part) { return String(part == null ? "" : part); })
      .join(" ")
      .toLowerCase();
  }

  function matchByTags(modules, haystack) {
    var i;
    var j;
    var tags;
    var tag;
    for (i = 0; i < modules.length; i += 1) {
      tags = Array.isArray(modules[i].tags) ? modules[i].tags : [];
      for (j = 0; j < tags.length; j += 1) {
        tag = String(tags[j] || "").trim().toLowerCase();
        if (tag && haystack.indexOf(tag) !== -1) return modules[i];
      }
    }
    return null;
  }

  function pickByRotation(modules, opened, startIndex) {
    if (!modules.length) return null;
    var start = ((startIndex % modules.length) + modules.length) % modules.length;
    var i;
    var idx;
    var unopened = [];
    for (i = 0; i < modules.length; i += 1) {
      idx = (start + i) % modules.length;
      if (opened.indexOf(modules[idx].id) === -1) unopened.push(modules[idx]);
    }
    if (unopened.length) return unopened[0];
    return modules[start];
  }

  /**
   * @param {object} opts
   * @param {Array} opts.modules - manifest.modules
   * @param {string} [opts.title]
   * @param {string} [opts.body]
   * @param {string} [opts.place]
   * @param {Storage} [opts.storage]
   * @param {boolean} [opts.advanceRotate=true]
   */
  function pickExercise(opts) {
    var options = opts || {};
    var modules = Array.isArray(options.modules) ? options.modules.filter(Boolean) : [];
    if (!modules.length) return null;
    var storage = options.storage;
    if (storage == null && typeof localStorage !== "undefined") storage = localStorage;
    var haystack = normalizeHaystack([options.title, options.body, options.place]);
    var matched = matchByTags(modules, haystack);
    if (matched) return matched;
    var picked = pickByRotation(modules, openedIds(storage), rotateIndex(storage));
    if (options.advanceRotate !== false) bumpRotate(storage, modules.length);
    return picked;
  }

  function recommendationFromModule(mod) {
    if (!mod || !mod.id) return null;
    return {
      moduleId: String(mod.id),
      name: String(mod.name || mod.id),
      description: String(mod.description || ""),
      recommendedAt: new Date().toISOString(),
      dismissed: false,
    };
  }

  function ensureRecommendation(essay, opts) {
    if (essay && essay.exerciseRecommendation && essay.exerciseRecommendation.moduleId) {
      return essay.exerciseRecommendation;
    }
    var picked = pickExercise(opts);
    var rec = recommendationFromModule(picked);
    if (essay && rec) essay.exerciseRecommendation = rec;
    return rec;
  }

  return {
    OPENED_KEY: OPENED_KEY,
    ROTATE_KEY: ROTATE_KEY,
    openedIds: openedIds,
    markOpened: markOpened,
    rotateIndex: rotateIndex,
    bumpRotate: bumpRotate,
    matchByTags: matchByTags,
    pickByRotation: pickByRotation,
    pickExercise: pickExercise,
    recommendationFromModule: recommendationFromModule,
    ensureRecommendation: ensureRecommendation,
  };
});
