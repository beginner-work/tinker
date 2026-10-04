/* Owner edit-log helpers: diff text, sanitize ops, apply for replay.
 *
 * Only the metrics owner may persist ops that contain text. Non-owner
 * payloads must never include string content in ops.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.tinkerAnalyticsOwnerEdit = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var MAX_OPS = 2000;
  var MAX_TEXT = 20000;

  function commonPrefixLen(a, b) {
    var n = Math.min(a.length, b.length);
    var i = 0;
    while (i < n && a.charAt(i) === b.charAt(i)) i += 1;
    return i;
  }

  function commonSuffixLen(a, b, prefix) {
    var i = a.length - 1;
    var j = b.length - 1;
    var n = 0;
    while (i >= prefix && j >= prefix && a.charAt(i) === b.charAt(j)) {
      n += 1;
      i -= 1;
      j -= 1;
    }
    return n;
  }

  /** Diff prev→next into at most one delete + one insert at a caret. */
  function diffEdit(prev, next, ms) {
    var a = String(prev == null ? "" : prev);
    var b = String(next == null ? "" : next);
    if (a === b) return [];
    var t = Math.max(0, Math.round(Number(ms) || 0));
    var pre = commonPrefixLen(a, b);
    var suf = commonSuffixLen(a, b, pre);
    var aMid = a.slice(pre, a.length - suf);
    var bMid = b.slice(pre, b.length - suf);
    var ops = [];
    if (aMid.length) {
      ops.push({ t: t, op: "del", pos: pre, text: aMid, len: aMid.length });
    }
    if (bMid.length) {
      ops.push({ t: t, op: "ins", pos: pre, text: bMid });
    }
    return ops;
  }

  function markerOp(ms, mark) {
    return {
      t: Math.max(0, Math.round(Number(ms) || 0)),
      op: "mark",
      mark: String(mark || "").slice(0, 64),
    };
  }

  function sanitizeOps(raw, { allowText }) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    for (var i = 0; i < raw.length && out.length < MAX_OPS; i++) {
      var row = raw[i];
      if (!row || typeof row !== "object") continue;
      var t = Math.max(0, Math.round(Number(row.t) || 0));
      var op = String(row.op || "").toLowerCase();
      if (op === "mark") {
        var mark = String(row.mark || "").slice(0, 64);
        if (!mark) continue;
        out.push({ t: t, op: "mark", mark: mark });
        continue;
      }
      if (op === "ins") {
        var pos = Math.max(0, Math.round(Number(row.pos) || 0));
        if (!allowText) {
          // Non-owner: keep position + length only, drop text.
          var lenIns = typeof row.text === "string"
            ? row.text.length
            : Math.max(0, Math.round(Number(row.len) || 0));
          if (!lenIns) continue;
          out.push({ t: t, op: "ins", pos: pos, len: Math.min(lenIns, MAX_TEXT) });
          continue;
        }
        var text = typeof row.text === "string" ? row.text : "";
        if (!text) continue;
        if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
        out.push({ t: t, op: "ins", pos: pos, text: text });
        continue;
      }
      if (op === "del") {
        var posDel = Math.max(0, Math.round(Number(row.pos) || 0));
        if (!allowText) {
          var lenDel = typeof row.text === "string"
            ? row.text.length
            : Math.max(0, Math.round(Number(row.len) || 0));
          if (!lenDel) continue;
          out.push({ t: t, op: "del", pos: posDel, len: Math.min(lenDel, MAX_TEXT) });
          continue;
        }
        var delText = typeof row.text === "string" ? row.text : "";
        var len = delText
          ? delText.length
          : Math.max(0, Math.round(Number(row.len) || 0));
        if (!len) continue;
        if (delText.length > MAX_TEXT) delText = delText.slice(0, MAX_TEXT);
        var entry = { t: t, op: "del", pos: posDel, len: len };
        if (delText) entry.text = delText;
        out.push(entry);
        continue;
      }
    }
    return out;
  }

  function opsContainText(ops) {
    if (!Array.isArray(ops)) return false;
    for (var i = 0; i < ops.length; i++) {
      if (ops[i] && typeof ops[i].text === "string" && ops[i].text.length) return true;
    }
    return false;
  }

  function applyOps(ops) {
    var doc = "";
    var list = Array.isArray(ops) ? ops : [];
    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (!row) continue;
      if (row.op === "ins" && typeof row.text === "string") {
        var p = Math.max(0, Math.min(doc.length, row.pos | 0));
        doc = doc.slice(0, p) + row.text + doc.slice(p);
      } else if (row.op === "del") {
        var p2 = Math.max(0, Math.min(doc.length, row.pos | 0));
        var n = row.len != null
          ? Math.max(0, row.len | 0)
          : (typeof row.text === "string" ? row.text.length : 0);
        doc = doc.slice(0, p2) + doc.slice(p2 + n);
      }
    }
    return doc;
  }

  /** Snapshot document state at time ms (inclusive). */
  function docAt(ops, ms) {
    var cut = Math.max(0, Number(ms) || 0);
    return applyOps((ops || []).filter(function (o) { return o && o.t <= cut; }));
  }

  return {
    MAX_OPS: MAX_OPS,
    diffEdit: diffEdit,
    markerOp: markerOp,
    sanitizeOps: sanitizeOps,
    opsContainText: opsContainText,
    applyOps: applyOps,
    docAt: docAt,
  };
});
