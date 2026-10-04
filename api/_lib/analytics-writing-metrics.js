/* Numbers-only writing metrics for MCP + lindowlabs.dev export.
 *
 * Never returns session text, draft content, or per-character payloads.
 * Flow stretches, rankings, and weekly trends are aggregates only.
 */

"use strict";

const howIWrite = require("./analytics-how-i-write.js");
const flow = require("./analytics-flow.js");

const SURFACE_EVENT_NAMES = new Set([
  "prompt_shown",
  "surface_tapped",
  "editor_blur",
  "editor_focus",
  "scroll_up",
  "session_open",
  "session_end",
]);

function trimId(value, max) {
  if (typeof value !== "string") return "";
  const t = value.trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max) : t;
}

function dayKey(isoOrDate, timeZone) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return "";
  const tz = timeZone || "America/Los_Angeles";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  let y = "";
  let m = "";
  let day = "";
  for (const p of parts) {
    if (p.type === "year") y = p.value;
    if (p.type === "month") m = p.value;
    if (p.type === "day") day = p.value;
  }
  return y && m && day ? `${y}-${m}-${day}` : "";
}

function parseRange(range) {
  const raw = String(range || "12w").trim().toLowerCase();
  if (raw === "7d" || raw === "week") return { days: 7, label: "7d" };
  if (raw === "30d" || raw === "month") return { days: 30, label: "30d" };
  if (raw === "90d") return { days: 90, label: "90d" };
  // default 12 weeks
  return { days: 84, label: "12w" };
}

function markersFromSurfaceEvents(events, sessionStartedAt) {
  const startMs = sessionStartedAt instanceof Date
    ? sessionStartedAt.getTime()
    : Date.parse(sessionStartedAt);
  const base = Number.isFinite(startMs) ? startMs : null;
  const markers = [];
  for (const ev of events || []) {
    if (!ev) continue;
    const name = String(ev.name || "").toLowerCase();
    let kind = name;
    if (name === "editor_blur") kind = "blur";
    if (name === "editor_focus") kind = "focus";
    if (!SURFACE_EVENT_NAMES.has(name) && kind !== "blur" && kind !== "focus") continue;
    const ts = ev.ts instanceof Date ? ev.ts.getTime() : Date.parse(ev.ts);
    if (!Number.isFinite(ts)) continue;
    const t = base != null ? Math.max(0, ts - base) : 0;
    markers.push({
      t,
      kind,
      surfaceId: ev.surfaceId || "",
      promptId: ev.promptId || "",
      variantId: ev.variantId || "",
    });
  }
  return markers;
}

function stretchAbsoluteTimes(stretch, sessionStartedAt) {
  const start = sessionStartedAt instanceof Date
    ? sessionStartedAt.getTime()
    : Date.parse(sessionStartedAt);
  if (!Number.isFinite(start)) {
    return { startAt: null, endAt: null, startDay: "", endDay: "" };
  }
  const startAt = new Date(start + (stretch.startMs || 0));
  const endAt = new Date(start + (stretch.endMs || 0));
  return {
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    startDay: dayKey(startAt),
    endDay: dayKey(endAt),
  };
}

function bumpRank(map, key, field) {
  if (!key) return;
  if (!map[key]) {
    map[key] = { id: key, startsFlow: 0, breaksFlow: 0, shown: 0 };
  }
  map[key][field] = (map[key][field] || 0) + 1;
}

function rankList(map) {
  return Object.keys(map)
    .map((k) => map[k])
    .sort((a, b) => (b.startsFlow + b.breaksFlow) - (a.startsFlow + a.breaksFlow)
      || String(a.id).localeCompare(String(b.id)));
}

function promptVariantKey(promptId, variantId) {
  const p = promptId || "";
  const v = variantId || "A";
  if (!p) return "";
  return `${p}::${v}`;
}

/**
 * Build numbers-only metrics for one analyzed session + its flow stretches.
 * Strips any text fields that analyzeSession may have produced.
 */
function numbersOnlySession(analyzed, stretches, contextTag) {
  const stretchRows = (stretches || []).map((s) => {
    const abs = stretchAbsoluteTimes(s, analyzed.startedAt);
    return {
      startMs: s.startMs,
      endMs: s.endMs,
      lengthMs: s.lengthMs,
      lengthMinutes: Math.round((s.lengthMs / 60000) * 10) / 10,
      charsAdded: s.charsAdded,
      charsDeleted: s.charsDeleted,
      wordsAdded: s.wordsAdded,
      revisionRatio: s.revisionRatio,
      startCause: s.startCause,
      endCause: s.endCause,
      startPromptId: (s.startDetail && s.startDetail.promptId) || "",
      startVariantId: (s.startDetail && s.startDetail.variantId) || "",
      startSurfaceId: (s.startDetail && s.startDetail.surfaceId) || "",
      endPromptId: (s.endDetail && s.endDetail.promptId) || "",
      endVariantId: (s.endDetail && s.endDetail.variantId) || "",
      endSurfaceId: (s.endDetail && s.endDetail.surfaceId) || "",
      startAt: abs.startAt,
      endAt: abs.endAt,
      startDay: abs.startDay,
      endDay: abs.endDay,
    };
  });
  const flowMinutes = stretchRows.reduce((sum, s) => sum + (s.lengthMs || 0), 0) / 60000;
  const longest = stretchRows.reduce((max, s) => Math.max(max, s.lengthMs || 0), 0);
  return {
    sessionId: analyzed.sessionId,
    startedAt: analyzed.startedAt,
    startedDay: dayKey(analyzed.startedAt),
    week: analyzed.week,
    contextTag: contextTag || "",
    timeToFirstWordMs: analyzed.timeToFirstWordMs,
    typingPace: analyzed.typingPace,
    pauseShare: analyzed.pauseShare,
    pausesOver10s: analyzed.pausesOver10s,
    revisionRatio: analyzed.revisionRatio,
    earlyEditShare: analyzed.earlyEditShare,
    keepCraftingRounds: analyzed.keepCraftingRounds,
    sessionLengthMs: analyzed.sessionLengthMs,
    wordsKept: analyzed.wordsKept,
    charsTyped: analyzed.charsTyped,
    charsDeleted: analyzed.charsDeleted,
    flowMinutes: Math.round(flowMinutes * 10) / 10,
    longestStretchMs: longest,
    stretchCount: stretchRows.length,
    stretches: stretchRows,
  };
}

function enrichWeeklyTrends(sessions) {
  const base = howIWrite.weeklyTrends(sessions, 12);
  const byWeek = Object.create(null);
  for (const s of sessions || []) {
    const w = s.week || (s.startedAt ? howIWrite.weekKey(s.startedAt) : "");
    if (!w) continue;
    if (!byWeek[w]) byWeek[w] = [];
    byWeek[w].push(s);
  }
  return base.map((row) => {
    const rows = byWeek[row.week] || [];
    const flowSum = rows.reduce((a, r) => a + (r.flowMinutes || 0), 0);
    const longest = rows.reduce((a, r) => Math.max(a, r.longestStretchMs || 0), 0);
    return {
      week: row.week,
      sessions: row.sessions,
      flowMinutes: Math.round(flowSum * 10) / 10,
      longestStretchMs: longest || null,
      timeToFirstWordMs: row.timeToFirstWordMs,
      typingPace: row.typingPace,
      pauseShare: row.pauseShare,
      pausesOver10s: row.pausesOver10s,
      revisionRatio: row.revisionRatio,
      earlyEditShare: row.earlyEditShare,
      keepCraftingRounds: row.keepCraftingRounds,
      sessionLengthMs: row.sessionLengthMs,
      wordsKept: row.wordsKept,
    };
  });
}

function buildRankings(sessions) {
  const surfaces = Object.create(null);
  const prompts = Object.create(null);
  const variants = Object.create(null);

  for (const s of sessions || []) {
    for (const st of s.stretches || []) {
      if (st.startCause === "surface_tapped" && st.startSurfaceId) {
        bumpRank(surfaces, st.startSurfaceId, "startsFlow");
      }
      if (st.startCause === "prompt_shown" && st.startPromptId) {
        bumpRank(prompts, st.startPromptId, "startsFlow");
        bumpRank(variants, promptVariantKey(st.startPromptId, st.startVariantId), "startsFlow");
      }
      if (st.endCause === "surface_tapped" && st.endSurfaceId) {
        bumpRank(surfaces, st.endSurfaceId, "breaksFlow");
      }
      if (st.endCause === "prompt_shown" && st.endPromptId) {
        bumpRank(prompts, st.endPromptId, "breaksFlow");
        bumpRank(variants, promptVariantKey(st.endPromptId, st.endVariantId), "breaksFlow");
      }
    }
  }

  return {
    surfaces: rankList(surfaces).map((r) => ({
      surfaceId: r.id,
      startsFlow: r.startsFlow,
      breaksFlow: r.breaksFlow,
    })),
    prompts: rankList(prompts).map((r) => ({
      promptId: r.id,
      startsFlow: r.startsFlow,
      breaksFlow: r.breaksFlow,
    })),
    promptVariants: rankList(variants).map((r) => {
      const parts = String(r.id).split("::");
      return {
        promptId: parts[0] || "",
        variantId: parts[1] || "A",
        startsFlow: r.startsFlow,
        breaksFlow: r.breaksFlow,
      };
    }),
  };
}

function groupByContextTag(sessions) {
  const byTag = Object.create(null);
  for (const s of sessions || []) {
    const tag = s.contextTag || "(untagged)";
    if (!byTag[tag]) byTag[tag] = [];
    byTag[tag].push(s);
  }
  return Object.keys(byTag).sort().map((tag) => {
    const rows = byTag[tag];
    const avg = (getter) => {
      const vals = rows.map(getter).filter((v) => v != null && Number.isFinite(v));
      if (!vals.length) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    return {
      contextTag: tag === "(untagged)" ? "" : tag,
      sessions: rows.length,
      flowMinutes: Math.round(rows.reduce((a, r) => a + (r.flowMinutes || 0), 0) * 10) / 10,
      timeToFirstWordMs: avg((r) => r.timeToFirstWordMs),
      typingPace: avg((r) => r.typingPace),
      pauseShare: avg((r) => r.pauseShare),
      revisionRatio: avg((r) => r.revisionRatio),
      wordsKept: avg((r) => r.wordsKept),
      keepCraftingRounds: avg((r) => r.keepCraftingRounds),
      longestStretchMs: rows.reduce((a, r) => Math.max(a, r.longestStretchMs || 0), 0) || null,
    };
  });
}

function flattenStretches(sessions) {
  const out = [];
  for (const s of sessions || []) {
    for (const st of s.stretches || []) {
      out.push({
        sessionId: s.sessionId,
        contextTag: s.contextTag || "",
        startAt: st.startAt,
        endAt: st.endAt,
        startDay: st.startDay,
        endDay: st.endDay,
        lengthMs: st.lengthMs,
        lengthMinutes: st.lengthMinutes,
        startCause: st.startCause,
        endCause: st.endCause,
        startPromptId: st.startPromptId,
        startVariantId: st.startVariantId,
        startSurfaceId: st.startSurfaceId,
        endPromptId: st.endPromptId,
        endVariantId: st.endVariantId,
        endSurfaceId: st.endSurfaceId,
        revisionRatio: st.revisionRatio,
        wordsAdded: st.wordsAdded,
      });
    }
  }
  out.sort((a, b) => String(b.startAt || "").localeCompare(String(a.startAt || "")));
  return out;
}

function timingFromSessions(sessions) {
  const allStretches = [];
  for (const s of sessions || []) {
    for (const st of s.stretches || []) {
      allStretches.push({
        startMs: 0,
        lengthMs: st.lengthMs,
        // reconstruct relative to absolute start via fake session start
        _absStart: st.startAt,
      });
    }
  }
  // Rebuild using absolute start times as sessionStartedAt + startMs=0
  const fake = allStretches.map((st) => ({
    startMs: 0,
    endMs: st.lengthMs,
    lengthMs: st.lengthMs,
    _startedAt: st._absStart,
  }));
  const byHour = new Array(24).fill(0);
  const byDow = new Array(7).fill(0);
  const tz = "America/Los_Angeles";
  for (const st of fake) {
    if (!st._startedAt) continue;
    const timing = flow.flowByHourAndDow(
      [{ startMs: 0, endMs: st.lengthMs, lengthMs: st.lengthMs }],
      st._startedAt,
      tz,
    );
    for (let h = 0; h < 24; h++) byHour[h] += timing.flowMinutesByHour[h] || 0;
    for (let d = 0; d < 7; d++) byDow[d] += timing.flowMinutesByDow[d] || 0;
  }
  return {
    timeZone: tz,
    flowMinutesByHour: byHour.map((v) => Math.round(v * 10) / 10),
    flowMinutesByDow: byDow.map((v) => Math.round(v * 10) / 10),
  };
}

/**
 * Assemble the full get_writing_metrics payload (numbers only).
 * @param {object[]} sessionBags - [{sessionId, startedAt, ops, contextTag, surfaceEvents}]
 */
function assembleWritingMetrics(sessionBags, rangeLabel) {
  const sessions = [];
  for (const bag of sessionBags || []) {
    const analyzed = howIWrite.analyzeSession(bag.ops, {
      sessionId: bag.sessionId,
      startedAt: bag.startedAt,
    });
    // Strip text-bearing fields before anything leaves this module.
    delete analyzed.mostRevisedPassages;
    delete analyzed.revisionsByParagraph;
    delete analyzed.longestPauses;
    const markers = markersFromSurfaceEvents(bag.surfaceEvents, bag.startedAt);
    const stretches = flow.detectFlowFromOps(bag.ops, markers);
    sessions.push(numbersOnlySession(analyzed, stretches, bag.contextTag || ""));
  }
  sessions.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));

  const weekly = enrichWeeklyTrends(sessions);
  const rankings = buildRankings(sessions);
  const byContextTag = groupByContextTag(sessions);
  const flowStretches = flattenStretches(sessions);
  const timing = timingFromSessions(sessions);

  return {
    range: rangeLabel || "12w",
    timeZone: "America/Los_Angeles",
    weeklyTrends: weekly,
    flowStretches,
    rankings,
    timing,
    byContextTag,
    sessions: sessions.map((s) => ({
      sessionId: s.sessionId,
      startedAt: s.startedAt,
      startedDay: s.startedDay,
      contextTag: s.contextTag,
      flowMinutes: s.flowMinutes,
      longestStretchMs: s.longestStretchMs,
      timeToFirstWordMs: s.timeToFirstWordMs,
      typingPace: s.typingPace,
      pauseShare: s.pauseShare,
      pausesOver10s: s.pausesOver10s,
      revisionRatio: s.revisionRatio,
      earlyEditShare: s.earlyEditShare,
      wordsKept: s.wordsKept,
      keepCraftingRounds: s.keepCraftingRounds,
      sessionLengthMs: s.sessionLengthMs,
      stretchCount: s.stretchCount,
    })),
  };
}

/**
 * Slim public export for lindowlabs.dev build-time pull.
 * No text, no context tags, no timestamps finer than the day.
 */
function assembleWritingSummary(sessionBags) {
  const full = assembleWritingMetrics(sessionBags, "12w");
  return {
    generatedDay: dayKey(new Date()),
    timeZone: "America/Los_Angeles",
    weekly: (full.weeklyTrends || []).map((w) => ({
      week: w.week,
      flowMinutes: w.flowMinutes,
      timeToFirstWordMs: w.timeToFirstWordMs == null
        ? null
        : Math.round(w.timeToFirstWordMs),
      revisionRate: w.revisionRatio == null
        ? null
        : Math.round(w.revisionRatio * 1000) / 1000,
    })),
    promptRankings: (full.rankings && full.rankings.promptVariants
      ? full.rankings.promptVariants
      : []).map((r) => ({
      promptId: r.promptId,
      variantId: r.variantId,
      startsFlow: r.startsFlow,
      breaksFlow: r.breaksFlow,
    })),
  };
}

function sanitizeSurfaceEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = trimId(String(raw.name || "").toLowerCase(), 64);
  if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) return null;
  const sessionId = trimId(raw.sessionId || raw.session_id, 80);
  if (!sessionId) return null;
  const anonymousId = trimId(raw.anonymousId || raw.anonymous_id, 80);
  const surfaceId = trimId(raw.surfaceId || raw.surface_id, 64);
  const promptId = trimId(raw.promptId || raw.prompt_id, 64);
  const variantId = trimId(raw.variantId || raw.variant_id, 32);
  const position = trimId(raw.position, 32);
  let ts = raw.ts || raw.timestamp ? new Date(raw.ts || raw.timestamp) : new Date();
  if (Number.isNaN(ts.getTime())) ts = new Date();
  return {
    name,
    sessionId,
    anonymousId,
    surfaceId,
    promptId,
    variantId,
    position,
    ts,
    props: {},
  };
}

module.exports = {
  SURFACE_EVENT_NAMES,
  parseRange,
  dayKey,
  markersFromSurfaceEvents,
  numbersOnlySession,
  enrichWeeklyTrends,
  buildRankings,
  groupByContextTag,
  assembleWritingMetrics,
  assembleWritingSummary,
  sanitizeSurfaceEvent,
  trimId,
};
