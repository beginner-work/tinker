/* Passage + editor payload helpers for /story-parts. Pure; no DOM. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.tinkerStoryPartsExcerpt = api;
  else if (root) root.tinkerStoryPartsExcerpt = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  function clampRange(text, start, end) {
    var len = typeof text === "string" ? text.length : 0;
    var a = Number(start);
    var b = Number(end);
    if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("Selection range is required.");
    if (a > b) { var t = a; a = b; b = t; }
    a = Math.max(0, Math.min(len, Math.floor(a)));
    b = Math.max(0, Math.min(len, Math.floor(b)));
    return { start: a, end: b };
  }
  function passageFromSelection(text, start, end) {
    if (typeof text !== "string") throw new Error("Source text is required.");
    var range = clampRange(text, start, end);
    if (range.start === range.end) throw new Error("Select a passage first.");
    var excerpt = text.slice(range.start, range.end);
    return { body: excerpt, sourceExcerpt: excerpt, start: range.start, end: range.end };
  }
  function sourceRef(kind, id) {
    var sourceKind = kind || "none";
    if (sourceKind === "none") return { sourceKind: "none", sourceId: null };
    if (!id) throw new Error("sourceId is required.");
    return { sourceKind: sourceKind, sourceId: String(id) };
  }
  function prefillPart(text, start, end, kind, id) {
    return Object.assign({}, passageFromSelection(text, start, end), sourceRef(kind, id));
  }
  function splitList(value) {
    if (value == null || value === "") return [];
    return String(value).split(",").map(function (item) { return item.trim(); }).filter(Boolean);
  }
  function buildPartPayload(input) {
    var seed = input || {};
    var repo = seed.repo || "";
    var sourceKind = seed.sourceKind || "none";
    var sourceId = seed.sourceId || null;
    if (String(repo).trim() || sourceKind === "code") {
      sourceKind = "code";
      sourceId = seed.sourceId || null;
    }
    return {
      title: seed.title || "",
      stageKey: seed.stageKey || "",
      body: seed.body || "",
      concepts: splitList(seed.concepts),
      stack: splitList(seed.stack),
      fields: seed.fields || {},
      sourceExcerpt: seed.sourceExcerpt || "",
      sourceKind: sourceKind,
      sourceId: sourceId,
      sourceRef: {
        repo: repo,
        path: seed.path || "",
        ref: seed.ref || "",
        evidence: splitList(seed.evidence),
      },
    };
  }
  return {
    clampRange: clampRange,
    passageFromSelection: passageFromSelection,
    sourceRef: sourceRef,
    prefillPart: prefillPart,
    splitList: splitList,
    buildPartPayload: buildPartPayload,
  };
});
