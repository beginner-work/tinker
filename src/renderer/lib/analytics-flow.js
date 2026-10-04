/* Flow detection from keystroke / edit streams.
 *
 * FLOW_PAUSE_MS — max gap inside a flow stretch (default 30s).
 * FLOW_MIN_MS   — minimum stretch length to count (default 3 minutes).
 *
 * Works on content-free keystroke packs (all users) and owner edit ops.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      typeof require === "function" ? require("./analytics-keystrokes.js") : null
    );
  } else {
    root.tinkerAnalyticsFlow = factory(root.tinkerAnalyticsKeystrokes || null);
  }
})(typeof self !== "undefined" ? self : this, function (keystrokes) {
  "use strict";

  /** Single place to tune flow sensitivity. */
  var FLOW_PAUSE_MS = 30 * 1000;
  var FLOW_MIN_MS = 3 * 60 * 1000;

  var CAT = keystrokes && keystrokes.CAT ? keystrokes.CAT : {
    letter: 0, digit: 1, space: 2, punctuation: 3, enter: 4,
    backspace: 5, delete: 6, paste: 11, cut: 12, ime: 13,
  };

  function isTypingCat(cat) {
    return cat === CAT.letter || cat === CAT.digit || cat === CAT.space
      || cat === CAT.punctuation || cat === CAT.enter
      || cat === CAT.paste || cat === CAT.ime;
  }

  function isDeleteCat(cat) {
    return cat === CAT.backspace || cat === CAT.delete || cat === CAT.cut;
  }

  /**
   * markers: [{ t, kind, surfaceId?, promptId?, variantId? }]
   * kind ∈ prompt_shown | surface_tapped | blur | focus | scroll_up | session_open | session_end
   */
  function nearestMarker(markers, t, direction, windowMs) {
    var list = Array.isArray(markers) ? markers : [];
    var best = null;
    var bestDist = Infinity;
    var win = windowMs != null ? windowMs : 15000;
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m) continue;
      var dt = m.t - t;
      if (direction === "before" && dt > 0) continue;
      if (direction === "after" && dt < 0) continue;
      var dist = Math.abs(dt);
      if (dist <= win && dist < bestDist) {
        bestDist = dist;
        best = m;
      }
    }
    return best;
  }

  function classifyEndCause(markers, endT, nextGap) {
    var m = nearestMarker(markers, endT, "after", 10000)
      || nearestMarker(markers, endT, "before", 5000);
    if (m) {
      if (m.kind === "prompt_shown") return { cause: "prompt_shown", detail: m };
      if (m.kind === "surface_tapped") return { cause: "surface_tapped", detail: m };
      if (m.kind === "blur") return { cause: "blur", detail: m };
      if (m.kind === "scroll_up") return { cause: "scroll_up", detail: m };
      if (m.kind === "session_end") return { cause: "session_end", detail: m };
    }
    if (nextGap == null || nextGap >= FLOW_PAUSE_MS) {
      return { cause: "long_pause", detail: null };
    }
    return { cause: "long_pause", detail: null };
  }

  function classifyStartCause(markers, startT) {
    var m = nearestMarker(markers, startT, "before", 15000);
    if (m) {
      if (m.kind === "session_open") return { cause: "session_open", detail: m };
      if (m.kind === "prompt_shown") return { cause: "prompt_shown", detail: m };
      if (m.kind === "surface_tapped") return { cause: "surface_tapped", detail: m };
      if (m.kind === "focus") return { cause: "returning_from_blur", detail: m };
    }
    return { cause: "unknown", detail: null };
  }

  /**
   * Detect flow stretches from packed keystroke rows [[ms, cat, count?], ...]
   * and optional markers.
   */
  function detectFlowStretches(packed, markers, opts) {
    var pauseMs = (opts && opts.pauseMs != null) ? opts.pauseMs : FLOW_PAUSE_MS;
    var minMs = (opts && opts.minMs != null) ? opts.minMs : FLOW_MIN_MS;
    var rows = Array.isArray(packed) ? packed.slice().sort(function (a, b) { return a[0] - b[0]; }) : [];
    var stretches = [];
    if (!rows.length) return stretches;

    var start = null;
    var last = null;
    var typed = 0;
    var deleted = 0;

    function closeStretch(endT, nextGap) {
      if (start == null || last == null) return;
      var lengthMs = last - start;
      if (lengthMs >= minMs) {
        var endInfo = classifyEndCause(markers, last, nextGap);
        var startInfo = classifyStartCause(markers, start);
        stretches.push({
          startMs: start,
          endMs: last,
          lengthMs: lengthMs,
          charsAdded: typed,
          charsDeleted: deleted,
          wordsAdded: Math.round(typed / 5),
          revisionRatio: typed ? Math.round((deleted / typed) * 1000) / 1000 : 0,
          endCause: endInfo.cause,
          endDetail: endInfo.detail,
          startCause: startInfo.cause,
          startDetail: startInfo.detail,
        });
      }
      start = null;
      last = null;
      typed = 0;
      deleted = 0;
    }

    for (var i = 0; i < rows.length; i++) {
      var ms = rows[i][0];
      var cat = rows[i][1];
      var count = rows[i][2] != null ? rows[i][2] : 1;
      var active = isTypingCat(cat) || isDeleteCat(cat);
      if (!active) continue;

      if (start == null) {
        start = ms;
        last = ms;
      } else if (ms - last > pauseMs) {
        closeStretch(last, ms - last);
        start = ms;
        last = ms;
        typed = 0;
        deleted = 0;
      } else {
        last = ms;
      }

      if (isTypingCat(cat)) typed += (cat === CAT.paste || cat === CAT.ime) ? count : 1;
      if (isDeleteCat(cat)) deleted += (cat === CAT.cut) ? count : 1;
    }
    closeStretch(last, null);
    return stretches;
  }

  /** Same detection from owner edit ops ({t, op, text?}). */
  function detectFlowFromOps(ops, markers, opts) {
    var packed = [];
    (ops || []).forEach(function (row) {
      if (!row) return;
      if (row.op === "ins") {
        var n = typeof row.text === "string" ? row.text.length : (row.len || 1);
        packed.push([row.t, CAT.letter, n]);
      } else if (row.op === "del") {
        var d = typeof row.text === "string" ? row.text.length : (row.len || 1);
        packed.push([row.t, CAT.backspace, d]);
      } else if (row.op === "mark") {
        // markers should be passed separately; ignore here
      }
    });
    return detectFlowStretches(packed, markers, opts);
  }

  function flowByHourAndDow(stretches, sessionStartedAt, timeZone) {
    var tz = timeZone || "America/Los_Angeles";
    var byHour = new Array(24).fill(0);
    var byDow = new Array(7).fill(0); // 0=Sun
    var perDay = Object.create(null);

    (stretches || []).forEach(function (s) {
      var abs = sessionStartedAt
        ? new Date(new Date(sessionStartedAt).getTime() + s.startMs)
        : null;
      if (!abs || Number.isNaN(abs.getTime())) return;
      var parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "numeric",
        hour12: false,
        weekday: "short",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(abs);
      var hour = 0;
      var weekday = "Mon";
      var y = "";
      var m = "";
      var d = "";
      parts.forEach(function (p) {
        if (p.type === "hour") hour = Number(p.value) % 24;
        if (p.type === "weekday") weekday = p.value;
        if (p.type === "year") y = p.value;
        if (p.type === "month") m = p.value;
        if (p.type === "day") d = p.value;
      });
      var mins = s.lengthMs / 60000;
      byHour[hour] += mins;
      var dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      var dow = dowMap[weekday] != null ? dowMap[weekday] : 1;
      byDow[dow] += mins;
      var dayKey = y + "-" + m + "-" + d;
      if (!perDay[dayKey] || s.lengthMs > perDay[dayKey]) perDay[dayKey] = s.lengthMs;
    });

    return {
      timeZone: tz,
      flowMinutesByHour: byHour.map(function (v) { return Math.round(v * 10) / 10; }),
      flowMinutesByDow: byDow.map(function (v) { return Math.round(v * 10) / 10; }),
      longestStretchByDay: Object.keys(perDay).sort().map(function (day) {
        return { day: day, lengthMs: perDay[day] };
      }),
    };
  }

  function aggregateEndCauses(stretches) {
    var counts = Object.create(null);
    (stretches || []).forEach(function (s) {
      var c = s.endCause || "unknown";
      counts[c] = (counts[c] || 0) + 1;
    });
    return counts;
  }

  function aggregateStartCauses(stretches) {
    var counts = Object.create(null);
    (stretches || []).forEach(function (s) {
      var c = s.startCause || "unknown";
      counts[c] = (counts[c] || 0) + 1;
    });
    return counts;
  }

  return {
    FLOW_PAUSE_MS: FLOW_PAUSE_MS,
    FLOW_MIN_MS: FLOW_MIN_MS,
    detectFlowStretches: detectFlowStretches,
    detectFlowFromOps: detectFlowFromOps,
    flowByHourAndDow: flowByHourAndDow,
    aggregateEndCauses: aggregateEndCauses,
    aggregateStartCauses: aggregateStartCauses,
    classifyEndCause: classifyEndCause,
    classifyStartCause: classifyStartCause,
  };
});
