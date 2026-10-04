/* Derive "How I write" learning metrics from owner edit logs.
 *
 * Pure functions for tests. No AI — summaries are simple rule comparisons
 * of last-7-day averages vs the prior 4 weeks.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(
      typeof require === "function" ? require("./analytics-owner-edit.js") : null
    );
  } else {
    root.tinkerAnalyticsHowIWrite = factory(root.tinkerAnalyticsOwnerEdit || null);
  }
})(typeof self !== "undefined" ? self : this, function (ownerEdit) {
  "use strict";

  if (!ownerEdit) throw new Error("analytics-owner-edit required");

  function weekKey(ts) {
    var d = ts instanceof Date ? new Date(ts.getTime()) : new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    // ISO week: Thursday-based week year
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
    var week1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    var week = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
    var y = d.getUTCFullYear();
    return y + "-W" + String(week).padStart(2, "0");
  }

  function wordCount(text) {
    var t = String(text || "").trim();
    if (!t) return 0;
    return t.split(/\s+/).filter(Boolean).length;
  }

  function paragraphRanges(text) {
    var s = String(text || "");
    var ranges = [];
    var start = 0;
    var parts = s.split(/\n+/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p.length && i === parts.length - 1) continue;
      var end = start + p.length;
      ranges.push({ index: ranges.length, start: start, end: end, text: p });
      start = end + 1; // account for the newline consumed by split
    }
    if (!ranges.length) ranges.push({ index: 0, start: 0, end: s.length, text: s });
    return ranges;
  }

  function paragraphIndexAt(ranges, pos) {
    for (var i = 0; i < ranges.length; i++) {
      if (pos >= ranges[i].start && pos <= ranges[i].end) return i;
    }
    return Math.max(0, ranges.length - 1);
  }

  /** Analyze one session's ordered ops (+ optional marker events). */
  function analyzeSession(ops, meta) {
    var list = Array.isArray(ops) ? ops.slice().sort(function (a, b) { return a.t - b.t; }) : [];
    var startedAt = meta && meta.startedAt ? new Date(meta.startedAt) : null;
    var sessionId = (meta && meta.sessionId) || "";

    var typed = 0;
    var deleted = 0;
    var earlyEdits = 0; // edits that go back into earlier text (not at end)
    var endEdits = 0;
    var keepCrafting = 0;
    var thisIsEverything = 0;
    var firstInsAt = null;
    var lastT = 0;
    var pausedMs = 0;
    var activeMs = 0;
    var pausesOver10s = 0;
    var pauseList = [];
    var prevT = null;
    var doc = "";
    var paraDelCounts = [];
    var passageHits = Object.create(null); // key → { before, after, dels, pos }

    function ensurePara(n) {
      while (paraDelCounts.length <= n) paraDelCounts.push(0);
    }

    for (var i = 0; i < list.length; i++) {
      var row = list[i];
      if (!row) continue;
      var t = Math.max(0, Number(row.t) || 0);
      lastT = Math.max(lastT, t);
      if (prevT != null) {
        var gap = t - prevT;
        if (gap >= 10000) {
          pausesOver10s += 1;
          pausedMs += gap;
          pauseList.push({ t: prevT, durationMs: gap, pos: doc.length, docLen: doc.length });
        } else if (gap >= 2000) {
          pausedMs += gap;
          pauseList.push({ t: prevT, durationMs: gap, pos: doc.length, docLen: doc.length });
        } else if (gap > 0) {
          activeMs += gap;
        }
      }
      prevT = t;

      if (row.op === "mark") {
        if (row.mark === "keep_crafting") keepCrafting += 1;
        if (row.mark === "this_is_everything") thisIsEverything += 1;
        continue;
      }

      var atEnd = (row.pos | 0) >= doc.length;
      if (row.op === "ins" && typeof row.text === "string") {
        if (firstInsAt == null && /[A-Za-z0-9]/.test(row.text)) firstInsAt = t;
        typed += row.text.length;
        if (atEnd) endEdits += 1;
        else earlyEdits += 1;
        var p = Math.max(0, Math.min(doc.length, row.pos | 0));
        doc = doc.slice(0, p) + row.text + doc.slice(p);
      } else if (row.op === "del") {
        var pos = Math.max(0, Math.min(doc.length, row.pos | 0));
        var len = row.len != null
          ? Math.max(0, row.len | 0)
          : (typeof row.text === "string" ? row.text.length : 0);
        var removed = typeof row.text === "string" ? row.text : doc.slice(pos, pos + len);
        deleted += removed.length;
        if (pos >= doc.length) endEdits += 1;
        else earlyEdits += 1;
        var ranges = paragraphRanges(doc);
        var pi = paragraphIndexAt(ranges, pos);
        ensurePara(pi);
        paraDelCounts[pi] += removed.length;
        var before = doc;
        var after = doc.slice(0, pos) + doc.slice(pos + len);
        var key = String(pos) + ":" + String(len);
        var hit = passageHits[key];
        if (!hit || removed.length > hit.dels) {
          passageHits[key] = {
            pos: pos,
            dels: removed.length,
            before: before.slice(Math.max(0, pos - 40), Math.min(before.length, pos + len + 40)),
            after: after.slice(Math.max(0, pos - 40), Math.min(after.length, pos + 40)),
            removed: removed.slice(0, 200),
          };
        }
        doc = after;
      }
    }

    var durationMs = lastT;
    var wordsKept = wordCount(doc);
    var revisionRatio = typed ? deleted / typed : 0;
    var earlyShare = (earlyEdits + endEdits) ? earlyEdits / (earlyEdits + endEdits) : 0;
    var pauseShare = durationMs ? pausedMs / durationMs : 0;
    var minutes = Math.max(durationMs / 60000, 1 / 60);
    var typingPace = typed / minutes; // chars per minute
    var timeToFirstWordMs = firstInsAt;
    var revisionsByParagraph = paraDelCounts.map(function (n, idx) {
      return { paragraph: idx + 1, deletedChars: n };
    });
    var topPassages = Object.keys(passageHits)
      .map(function (k) { return passageHits[k]; })
      .sort(function (a, b) { return b.dels - a.dels; })
      .slice(0, 5);
    pauseList.sort(function (a, b) { return b.durationMs - a.durationMs; });

    return {
      sessionId: sessionId,
      startedAt: startedAt ? startedAt.toISOString() : null,
      week: startedAt ? weekKey(startedAt) : "",
      timeToFirstWordMs: timeToFirstWordMs,
      typingPace: Math.round(typingPace * 10) / 10,
      pauseShare: Math.round(pauseShare * 1000) / 1000,
      pausesOver10s: pausesOver10s,
      revisionRatio: Math.round(revisionRatio * 1000) / 1000,
      earlyEditShare: Math.round(earlyShare * 1000) / 1000,
      keepCraftingRounds: keepCrafting,
      sessionLengthMs: durationMs,
      wordsKept: wordsKept,
      charsTyped: typed,
      charsDeleted: deleted,
      longestPauses: pauseList.slice(0, 8),
      revisionsByParagraph: revisionsByParagraph,
      mostRevisedPassages: topPassages,
      finalTextLength: doc.length,
    };
  }

  function avg(rows, getter) {
    var vals = rows.map(getter).filter(function (v) { return v != null && Number.isFinite(v); });
    if (!vals.length) return null;
    return vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  }

  function weeklyTrends(sessions, weeks) {
    var n = Math.max(1, Math.min(12, Number(weeks) || 12));
    var byWeek = Object.create(null);
    (sessions || []).forEach(function (s) {
      var w = s.week || (s.startedAt ? weekKey(s.startedAt) : "");
      if (!w) return;
      if (!byWeek[w]) byWeek[w] = [];
      byWeek[w].push(s);
    });
    var keys = Object.keys(byWeek).sort();
    if (keys.length > n) keys = keys.slice(keys.length - n);
    return keys.map(function (w) {
      var rows = byWeek[w];
      return {
        week: w,
        sessions: rows.length,
        timeToFirstWordMs: avg(rows, function (r) { return r.timeToFirstWordMs; }),
        typingPace: avg(rows, function (r) { return r.typingPace; }),
        pauseShare: avg(rows, function (r) { return r.pauseShare; }),
        pausesOver10s: avg(rows, function (r) { return r.pausesOver10s; }),
        revisionRatio: avg(rows, function (r) { return r.revisionRatio; }),
        earlyEditShare: avg(rows, function (r) { return r.earlyEditShare; }),
        keepCraftingRounds: avg(rows, function (r) { return r.keepCraftingRounds; }),
        sessionLengthMs: avg(rows, function (r) { return r.sessionLengthMs; }),
        wordsKept: avg(rows, function (r) { return r.wordsKept; }),
      };
    });
  }

  function periodAverage(sessions, sinceMs, untilMs) {
    var rows = (sessions || []).filter(function (s) {
      var t = s.startedAt ? Date.parse(s.startedAt) : NaN;
      if (!Number.isFinite(t)) return false;
      if (sinceMs != null && t < sinceMs) return false;
      if (untilMs != null && t >= untilMs) return false;
      return true;
    });
    return {
      sessions: rows.length,
      timeToFirstWordMs: avg(rows, function (r) { return r.timeToFirstWordMs; }),
      typingPace: avg(rows, function (r) { return r.typingPace; }),
      pauseShare: avg(rows, function (r) { return r.pauseShare; }),
      pausesOver10s: avg(rows, function (r) { return r.pausesOver10s; }),
      revisionRatio: avg(rows, function (r) { return r.revisionRatio; }),
      earlyEditShare: avg(rows, function (r) { return r.earlyEditShare; }),
      keepCraftingRounds: avg(rows, function (r) { return r.keepCraftingRounds; }),
      sessionLengthMs: avg(rows, function (r) { return r.sessionLengthMs; }),
      wordsKept: avg(rows, function (r) { return r.wordsKept; }),
    };
  }

  function cmpDir(recent, baseline, higherIsBetter) {
    if (recent == null || baseline == null || !Number.isFinite(recent) || !Number.isFinite(baseline)) {
      return null;
    }
    if (baseline === 0) return recent === 0 ? "same" : (recent > 0 ? "up" : "down");
    var delta = (recent - baseline) / Math.abs(baseline);
    if (Math.abs(delta) < 0.08) return "same";
    var up = delta > 0;
    if (higherIsBetter == null) return up ? "up" : "down";
    return up ? (higherIsBetter ? "better" : "worse") : (higherIsBetter ? "worse" : "better");
  }

  /** Rule-based plain-language summary: last 7 days vs prior 4 weeks. */
  function summarizeLearning(sessions, now) {
    var t = now || Date.now();
    var d7 = 7 * 86400000;
    var d28 = 28 * 86400000;
    var recent = periodAverage(sessions, t - d7, t);
    var prior = periodAverage(sessions, t - d7 - d28, t - d7);
    var bits = [];

    if (!recent.sessions) {
      return {
        text: "No writing sessions in the last 7 days yet. Keep a few entries and this summary will fill in.",
        recent: recent,
        prior: prior,
      };
    }
    if (!prior.sessions) {
      return {
        text: "You have recent sessions, but not enough history in the prior four weeks to compare yet.",
        recent: recent,
        prior: prior,
      };
    }

    var start = cmpDir(recent.timeToFirstWordMs, prior.timeToFirstWordMs, false);
    if (start === "better") bits.push("You start writing faster");
    else if (start === "worse") bits.push("You take longer to get the first words down");

    var pace = cmpDir(recent.typingPace, prior.typingPace, true);
    if (pace === "better") bits.push("your typing pace is up");
    else if (pace === "worse") bits.push("your typing pace is down");

    var rev = cmpDir(recent.revisionRatio, prior.revisionRatio, false);
    var early = cmpDir(recent.earlyEditShare, prior.earlyEditShare, null);
    if (rev === "better" && early === "up") {
      bits.push("you revise less overall, and more of the edits land in the middle rather than at the end");
    } else if (rev === "better" && early === "down") {
      bits.push("you revise less, and more of what’s left is at the end");
    } else if (rev === "worse" && early === "up") {
      bits.push("you revise more, especially back into earlier text");
    } else if (rev === "worse") {
      bits.push("you revise more than you did");
    } else if (early === "up") {
      bits.push("more of your edits go back into earlier text instead of only at the end");
    } else if (early === "down") {
      bits.push("more of your edits stay at the end of the draft");
    }

    var pause = cmpDir(recent.pauseShare, prior.pauseShare, false);
    if (pause === "better") bits.push("you spend less time paused");
    else if (pause === "worse") bits.push("you spend more time paused");

    var kc = cmpDir(recent.keepCraftingRounds, prior.keepCraftingRounds, null);
    if (kc === "up") bits.push("Keep crafting rounds per entry are up");
    else if (kc === "down") bits.push("Keep crafting rounds per entry are down");

    var words = cmpDir(recent.wordsKept, prior.wordsKept, true);
    if (words === "better") bits.push("entries keep more words");
    else if (words === "worse") bits.push("entries keep fewer words");

    if (!bits.length) {
      return {
        text: "Your last 7 days look a lot like the prior four weeks — pace, pauses, and revision are steady.",
        recent: recent,
        prior: prior,
      };
    }

    // Capitalize first clause; join with commas / and.
    var text = bits[0].charAt(0).toUpperCase() + bits[0].slice(1);
    for (var i = 1; i < bits.length; i++) {
      if (i === bits.length - 1) text += ", and " + bits[i];
      else text += ", " + bits[i];
    }
    text += ".";
    return { text: text, recent: recent, prior: prior };
  }

  return {
    weekKey: weekKey,
    analyzeSession: analyzeSession,
    weeklyTrends: weeklyTrends,
    periodAverage: periodAverage,
    summarizeLearning: summarizeLearning,
    paragraphRanges: paragraphRanges,
  };
});
