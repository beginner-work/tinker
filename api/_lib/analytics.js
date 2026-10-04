/* Persist and query first-party analytics events + keystroke chunks.
 *
 * Ingest links anonymousId → userId at sign-in and freezes first-touch
 * attribution on AnalyticsIdentity so a utm-tagged landing survives
 * through signup_completed.
 *
 * Raw keystroke chunks are kept 90 days, then deleted after rolling into
 * AnalyticsWritingSession aggregates.
 */

"use strict";

const prisma = require("./db.js");
const {
  sanitizeEvent,
  attributionFromEvent,
  attributionHasValue,
} = require("./analytics-ingest.js");
const { summarize } = require("./analytics-aggregate.js");
const {
  sanitizePacked,
  deriveSessionMetrics,
  writingBehaviorRollup,
} = require("./analytics-keystrokes.js");
const ownerEdit = require("./analytics-owner-edit.js");
const howIWrite = require("./analytics-how-i-write.js");
const writingMetrics = require("./analytics-writing-metrics.js");

const MAX_BATCH = 40;
const MAX_KEYSTROKE_CHUNKS = 20;
const MAX_OWNER_EDIT_CHUNKS = 20;
const MAX_SURFACE_EVENTS = 40;
const KEYSTROKE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_CONTEXT_TAG = 64;

function parseAllowlist(raw) {
  const text = String(raw || "").trim();
  if (!text) return new Set();
  return new Set(
    text.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
  );
}

/**
 * Prefer METRICS_OWNER_ALLOWLIST. If unset/empty, fall back to
 * LEADS_OWNER_ALLOWLIST (already set on Vercel for Tyler). Both empty
 * → nobody (fail closed).
 */
function ownerAllowlist() {
  const metrics = parseAllowlist(process.env.METRICS_OWNER_ALLOWLIST);
  if (metrics.size) return metrics;
  return parseAllowlist(process.env.LEADS_OWNER_ALLOWLIST);
}

function isMetricsOwner(userId) {
  const id = String(userId || "").trim();
  if (!id) return false;
  // Empty allowlist (both METRICS and LEADS) = nobody (fail closed).
  return ownerAllowlist().has(id);
}

/** True when Postgres is missing analytics tables (migrations not applied). */
function isMissingAnalyticsSchema(err) {
  if (!err) return false;
  const code = String(err.code || "");
  if (code === "P2021") return true; // table does not exist
  const msg = String(err.message || err);
  if (/P2021\b/.test(msg)) return true;
  if (/does not exist/i.test(msg) && /(relation|table|Analytics)/i.test(msg)) {
    return true;
  }
  return false;
}

async function upsertIdentity(ev, userId) {
  const attr = attributionFromEvent(ev);
  const existing = await prisma.analyticsIdentity.findUnique({
    where: { anonymousId: ev.anonymousId },
  });
  if (!existing) {
    await prisma.analyticsIdentity.create({
      data: {
        anonymousId: ev.anonymousId,
        userId: userId || "",
        utmSource: attr.utmSource,
        utmMedium: attr.utmMedium,
        utmCampaign: attr.utmCampaign,
        utmContent: attr.utmContent,
        ref: attr.ref,
        referrerHost: attr.referrerHost,
        linkedAt: userId ? new Date() : null,
        updatedAt: new Date(),
      },
    });
    return {
      utmSource: attr.utmSource,
      utmMedium: attr.utmMedium,
      utmCampaign: attr.utmCampaign,
      utmContent: attr.utmContent,
      ref: attr.ref,
      referrerHost: attr.referrerHost,
    };
  }

  const patch = { updatedAt: new Date() };
  if (!existing.utmSource && attr.utmSource) patch.utmSource = attr.utmSource;
  if (!existing.utmMedium && attr.utmMedium) patch.utmMedium = attr.utmMedium;
  if (!existing.utmCampaign && attr.utmCampaign) patch.utmCampaign = attr.utmCampaign;
  if (!existing.utmContent && attr.utmContent) patch.utmContent = attr.utmContent;
  if (!existing.ref && attr.ref) patch.ref = attr.ref;
  if (!existing.referrerHost && attr.referrerHost) patch.referrerHost = attr.referrerHost;

  if (userId && !existing.userId) {
    patch.userId = userId;
    patch.linkedAt = new Date();
  } else if (userId && !existing.linkedAt) {
    patch.linkedAt = new Date();
  }

  if (Object.keys(patch).length > 1) {
    await prisma.analyticsIdentity.update({
      where: { anonymousId: ev.anonymousId },
      data: patch,
    });
  }

  return {
    utmSource: patch.utmSource != null ? patch.utmSource : existing.utmSource,
    utmMedium: patch.utmMedium != null ? patch.utmMedium : existing.utmMedium,
    utmCampaign: patch.utmCampaign != null ? patch.utmCampaign : existing.utmCampaign,
    utmContent: patch.utmContent != null ? patch.utmContent : existing.utmContent,
    ref: patch.ref != null ? patch.ref : existing.ref,
    referrerHost: patch.referrerHost != null ? patch.referrerHost : existing.referrerHost,
  };
}

async function ingestBatch(rawEvents, sessionUserId) {
  const list = Array.isArray(rawEvents) ? rawEvents.slice(0, MAX_BATCH) : [];
  const accepted = [];
  for (const raw of list) {
    const ev = sanitizeEvent(raw);
    if (!ev) continue;
    const userId = sessionUserId || ev.userId || "";
    let attr;
    try {
      attr = await upsertIdentity(ev, userId);
    } catch {
      attr = attributionFromEvent(ev);
    }
    if (!attributionHasValue(ev) && attributionHasValue(attr)) {
      ev.utmSource = attr.utmSource;
      ev.utmMedium = attr.utmMedium;
      ev.utmCampaign = attr.utmCampaign;
      ev.utmContent = attr.utmContent;
      ev.ref = attr.ref;
      ev.referrerHost = attr.referrerHost;
    } else if (attributionHasValue(attr)) {
      if (!ev.utmSource) ev.utmSource = attr.utmSource;
      if (!ev.utmMedium) ev.utmMedium = attr.utmMedium;
      if (!ev.utmCampaign) ev.utmCampaign = attr.utmCampaign;
      if (!ev.utmContent) ev.utmContent = attr.utmContent;
      if (!ev.ref) ev.ref = attr.ref;
      if (!ev.referrerHost) ev.referrerHost = attr.referrerHost;
    }
    if (userId) ev.userId = userId;
    accepted.push(ev);
  }

  if (!accepted.length) return { accepted: 0 };

  await prisma.analyticsEvent.createMany({
    data: accepted.map((ev) => ({
      name: ev.name,
      ts: ev.ts,
      anonymousId: ev.anonymousId,
      userId: ev.userId || "",
      sessionId: ev.sessionId,
      deviceType: ev.deviceType,
      viewportW: ev.viewportW,
      viewportH: ev.viewportH,
      path: ev.path,
      appVersion: ev.appVersion,
      utmSource: ev.utmSource,
      utmMedium: ev.utmMedium,
      utmCampaign: ev.utmCampaign,
      utmContent: ev.utmContent,
      ref: ev.ref,
      referrerHost: ev.referrerHost,
      props: ev.props,
    })),
  });

  // Keep writing-session aggregates fresh for CTA timing.
  for (const ev of accepted) {
    if (
      ev.name === "first_words_typed"
      || ev.name === "this_is_everything_tapped"
      || ev.name === "writing_session_ended"
    ) {
      try { await touchWritingSessionFromEvent(ev); } catch { /* ignore */ }
    }
  }

  return { accepted: accepted.length };
}

function trimId(value, max) {
  if (typeof value !== "string") return "";
  const t = value.trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max) : t;
}

async function ingestKeystrokeChunks(rawChunks, sessionUserId) {
  const list = Array.isArray(rawChunks) ? rawChunks.slice(0, MAX_KEYSTROKE_CHUNKS) : [];
  let accepted = 0;
  const touchedSessions = new Set();

  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const sessionId = trimId(raw.sessionId || raw.session_id, 80);
    const anonymousId = trimId(raw.anonymousId || raw.anonymous_id, 80);
    if (!sessionId || !anonymousId || anonymousId.length < 8) continue;
    const packed = sanitizePacked(raw.packed);
    if (!packed.length) continue;
    const startedAt = raw.startedAt || raw.started_at
      ? new Date(raw.startedAt || raw.started_at)
      : new Date();
    if (Number.isNaN(startedAt.getTime())) continue;
    const chunkIndex = Math.max(0, Math.min(100000, Number(raw.chunkIndex || raw.chunk_index) || 0)) | 0;
    const userId = sessionUserId || trimId(raw.userId || raw.user_id, 128);

    await prisma.analyticsKeystrokeChunk.create({
      data: {
        sessionId,
        anonymousId,
        userId: userId || "",
        startedAt,
        chunkIndex,
        packed,
      },
    });
    accepted += 1;
    touchedSessions.add(sessionId);
  }

  for (const sessionId of touchedSessions) {
    try { await recomputeWritingSession(sessionId); } catch { /* ignore */ }
  }

  return { accepted };
}

async function loadPackedForSession(sessionId) {
  const chunks = await prisma.analyticsKeystrokeChunk.findMany({
    where: { sessionId },
    orderBy: [{ chunkIndex: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
  const packed = [];
  for (const chunk of chunks) {
    const rows = sanitizePacked(chunk.packed);
    for (const row of rows) packed.push(row);
  }
  return { chunks, packed };
}

async function touchWritingSessionFromEvent(ev) {
  const sessionId = ev.sessionId;
  if (!sessionId) return;
  const existing = await prisma.analyticsWritingSession.findUnique({ where: { sessionId } });
  const ms = ev.ts instanceof Date ? ev.ts.getTime() : Date.parse(ev.ts);
  const patch = {
    anonymousId: ev.anonymousId,
    userId: ev.userId || (existing && existing.userId) || "",
    updatedAt: new Date(),
  };
  if (ev.name === "first_words_typed" && Number.isFinite(ms)) {
    const started = existing && existing.startedAt
      ? existing.startedAt.getTime()
      : ms;
    patch.timeToFirstWordMs = Math.max(0, ms - started);
  }
  if (ev.name === "this_is_everything_tapped" && Number.isFinite(ms) && existing) {
    const first = existing.timeToFirstWordMs;
    if (first != null) {
      const started = existing.startedAt.getTime();
      patch.timeFirstWordToDoneMs = Math.max(0, ms - started - first);
    }
    patch.endedAt = ev.ts;
  }
  if (ev.name === "writing_session_ended") {
    patch.endedAt = ev.ts;
  }

  if (!existing) {
    await prisma.analyticsWritingSession.create({
      data: {
        sessionId,
        anonymousId: ev.anonymousId,
        userId: ev.userId || "",
        startedAt: ev.ts,
        ...patch,
      },
    });
    return;
  }
  await prisma.analyticsWritingSession.update({
    where: { sessionId },
    data: patch,
  });
}

async function recomputeWritingSession(sessionId) {
  const { chunks, packed } = await loadPackedForSession(sessionId);
  if (!chunks.length) return null;
  const head = chunks[0];
  const existing = await prisma.analyticsWritingSession.findUnique({ where: { sessionId } });
  const metrics = deriveSessionMetrics(packed, {
    firstWordMs: existing && existing.timeToFirstWordMs != null ? existing.timeToFirstWordMs : null,
    doneMs: existing && existing.timeFirstWordToDoneMs != null
      && existing.timeToFirstWordMs != null
      ? existing.timeToFirstWordMs + existing.timeFirstWordToDoneMs
      : null,
  });
  // Preserve CTA-derived timings if already set.
  if (existing && existing.timeToFirstWordMs != null) {
    metrics.timeToFirstWordMs = existing.timeToFirstWordMs;
  }
  if (existing && existing.timeFirstWordToDoneMs != null) {
    metrics.timeFirstWordToDoneMs = existing.timeFirstWordToDoneMs;
  }

  const data = {
    sessionId,
    anonymousId: head.anonymousId,
    userId: head.userId || (existing && existing.userId) || "",
    startedAt: head.startedAt,
    endedAt: existing && existing.endedAt ? existing.endedAt : null,
    keyCount: metrics.keyCount,
    keysPerMinute: metrics.keysPerMinute,
    activeTypingMs: metrics.activeTypingMs,
    pausesOver2s: metrics.pausesOver2s,
    pausesOver10s: metrics.pausesOver10s,
    burstCount: metrics.burstCount,
    avgBurstLength: metrics.avgBurstLength,
    backspaceDeleteRatio: metrics.backspaceDeleteRatio,
    pasteCount: metrics.pasteCount,
    cutCount: metrics.cutCount,
    timeToFirstWordMs: metrics.timeToFirstWordMs,
    timeFirstWordToDoneMs: metrics.timeFirstWordToDoneMs,
    timeline: metrics.timeline,
    updatedAt: new Date(),
  };

  await prisma.analyticsWritingSession.upsert({
    where: { sessionId },
    create: data,
    update: data,
  });
  return data;
}

/** Roll raw chunks older than 90 days into session aggregates, then delete. */
async function rollupExpiredKeystrokes({ now } = {}) {
  const cutoff = new Date((now || Date.now()) - KEYSTROKE_RETENTION_MS);
  const old = await prisma.analyticsKeystrokeChunk.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { sessionId: true },
    distinct: ["sessionId"],
    take: 100,
  });
  let rolled = 0;
  for (const row of old) {
    await recomputeWritingSession(row.sessionId);
    await prisma.analyticsWritingSession.updateMany({
      where: { sessionId: row.sessionId },
      data: { rolledUpAt: new Date() },
    });
    await prisma.analyticsKeystrokeChunk.deleteMany({
      where: { sessionId: row.sessionId, createdAt: { lt: cutoff } },
    });
    rolled += 1;
  }
  return { rolled, cutoff: cutoff.toISOString() };
}

async function loadEventsSince(days) {
  const n = Math.max(1, Math.min(90, Number(days) || 7));
  const since = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  return prisma.analyticsEvent.findMany({
    where: { ts: { gte: since } },
    orderBy: { ts: "asc" },
    take: 20000,
  });
}

async function metricsSummary(days) {
  const events = await loadEventsSince(days);
  const base = summarize(events, days);
  const n = Math.max(1, Math.min(90, Number(days) || 7));
  const since = new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  const sessions = await prisma.analyticsWritingSession.findMany({
    where: { startedAt: { gte: since } },
    orderBy: { startedAt: "desc" },
    take: 500,
  });
  base.writingBehavior = writingBehaviorRollup(sessions);
  base.recentWritingSessions = sessions.slice(0, 40).map((s) => ({
    sessionId: s.sessionId,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    keyCount: s.keyCount,
    keysPerMinute: s.keysPerMinute,
    pausesOver2s: s.pausesOver2s,
    pausesOver10s: s.pausesOver10s,
    backspaceDeleteRatio: s.backspaceDeleteRatio,
    pasteCount: s.pasteCount,
    timeToFirstWordMs: s.timeToFirstWordMs,
    timeFirstWordToDoneMs: s.timeFirstWordToDoneMs,
    deviceHint: "",
  }));
  return base;
}

async function sessionTimeline(sessionId) {
  const id = trimId(sessionId, 80);
  if (!id) return null;
  let row = await prisma.analyticsWritingSession.findUnique({ where: { sessionId: id } });
  if (!row) {
    row = await recomputeWritingSession(id);
  }
  if (!row) return null;
  // Prefer live packed timeline if raw chunks still exist.
  const { packed } = await loadPackedForSession(id);
  if (packed.length) {
    const metrics = deriveSessionMetrics(packed, {
      firstWordMs: row.timeToFirstWordMs,
      doneMs: row.timeFirstWordToDoneMs != null && row.timeToFirstWordMs != null
        ? row.timeToFirstWordMs + row.timeFirstWordToDoneMs
        : null,
    });
    return {
      sessionId: id,
      startedAt: row.startedAt,
      metrics: {
        keyCount: metrics.keyCount,
        keysPerMinute: metrics.keysPerMinute,
        activeTypingMs: metrics.activeTypingMs,
        pausesOver2s: metrics.pausesOver2s,
        pausesOver10s: metrics.pausesOver10s,
        burstCount: metrics.burstCount,
        avgBurstLength: metrics.avgBurstLength,
        backspaceDeleteRatio: metrics.backspaceDeleteRatio,
        pasteCount: metrics.pasteCount,
        cutCount: metrics.cutCount,
        timeToFirstWordMs: row.timeToFirstWordMs,
        timeFirstWordToDoneMs: row.timeFirstWordToDoneMs,
      },
      timeline: metrics.timeline,
    };
  }
  return {
    sessionId: id,
    startedAt: row.startedAt,
    metrics: {
      keyCount: row.keyCount,
      keysPerMinute: row.keysPerMinute,
      activeTypingMs: row.activeTypingMs,
      pausesOver2s: row.pausesOver2s,
      pausesOver10s: row.pausesOver10s,
      burstCount: row.burstCount,
      avgBurstLength: row.avgBurstLength,
      backspaceDeleteRatio: row.backspaceDeleteRatio,
      pasteCount: row.pasteCount,
      cutCount: row.cutCount,
      timeToFirstWordMs: row.timeToFirstWordMs,
      timeFirstWordToDoneMs: row.timeFirstWordToDoneMs,
    },
    timeline: Array.isArray(row.timeline) ? row.timeline : [],
  };
}

async function recentEvents({ name, limit } = {}) {
  const take = Math.max(1, Math.min(200, Number(limit) || 50));
  const where = {};
  if (name && typeof name === "string" && name.trim()) {
    where.name = name.trim().toLowerCase();
  }
  return prisma.analyticsEvent.findMany({
    where,
    orderBy: { ts: "desc" },
    take,
    select: {
      id: true,
      name: true,
      ts: true,
      anonymousId: true,
      userId: true,
      sessionId: true,
      deviceType: true,
      path: true,
      appVersion: true,
      utmSource: true,
      utmMedium: true,
      utmCampaign: true,
      utmContent: true,
      ref: true,
      referrerHost: true,
      props: true,
    },
  });
}

/**
 * Owner-only edit logs. Non-owners are rejected (accepted: 0) and any
 * text in their payload is dropped by sanitizeOps({ allowText: false })
 * if somehow called — ingestOwnerEdits never persists for non-owners.
 */
async function ingestOwnerEdits(rawChunks, sessionUserId) {
  if (!isMetricsOwner(sessionUserId)) {
    return { accepted: 0, rejected: "not_owner" };
  }
  const list = Array.isArray(rawChunks) ? rawChunks.slice(0, MAX_OWNER_EDIT_CHUNKS) : [];
  let accepted = 0;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const sessionId = trimId(raw.sessionId || raw.session_id, 80);
    const anonymousId = trimId(raw.anonymousId || raw.anonymous_id, 80);
    if (!sessionId) continue;
    const ops = ownerEdit.sanitizeOps(raw.ops, { allowText: true });
    if (!ops.length) continue;
    const startedAt = raw.startedAt || raw.started_at
      ? new Date(raw.startedAt || raw.started_at)
      : new Date();
    if (Number.isNaN(startedAt.getTime())) continue;
    const chunkIndex = Math.max(0, Math.min(100000, Number(raw.chunkIndex || raw.chunk_index) || 0)) | 0;
    await prisma.analyticsOwnerEditChunk.create({
      data: {
        sessionId,
        userId: sessionUserId,
        anonymousId: anonymousId || "",
        startedAt,
        chunkIndex,
        ops,
      },
    });
    accepted += 1;
  }
  return { accepted };
}

async function loadOwnerOps(sessionId, userId) {
  const chunks = await prisma.analyticsOwnerEditChunk.findMany({
    where: { sessionId, userId },
    orderBy: [{ chunkIndex: "asc" }, { createdAt: "asc" }],
    take: 500,
  });
  const ops = [];
  for (const chunk of chunks) {
    const rows = ownerEdit.sanitizeOps(chunk.ops, { allowText: true });
    for (const row of rows) ops.push(row);
  }
  return { chunks, ops };
}

async function howIWriteOverview(userId) {
  if (!isMetricsOwner(userId)) {
    throw Object.assign(new Error("Not available for this account."), { status: 403 });
  }
  const since = new Date(Date.now() - 84 * 24 * 60 * 60 * 1000); // ~12 weeks
  const bags = await loadSessionBags(userId, since);
  const metrics = writingMetrics.assembleWritingMetrics(bags, "12w");
  // Owner UI still gets the learning summary text (rule-based, not session drafts).
  const sessionsForSummary = bags.map((bag) =>
    howIWrite.analyzeSession(bag.ops, {
      sessionId: bag.sessionId,
      startedAt: bag.startedAt,
    })
  );
  const summary = howIWrite.summarizeLearning(sessionsForSummary, Date.now());
  return {
    summary,
    trends: metrics.weeklyTrends,
    rankings: metrics.rankings,
    timing: metrics.timing,
    byContextTag: metrics.byContextTag,
    flowStretches: metrics.flowStretches.slice(0, 40),
    sessions: metrics.sessions,
  };
}

async function howIWriteSession(userId, sessionId) {
  if (!isMetricsOwner(userId)) {
    throw Object.assign(new Error("Not available for this account."), { status: 403 });
  }
  const id = trimId(sessionId, 80);
  if (!id) return null;
  const { chunks, ops } = await loadOwnerOps(id, userId);
  if (!chunks.length) return null;
  const analyzed = howIWrite.analyzeSession(ops, {
    sessionId: id,
    startedAt: chunks[0].startedAt,
  });
  // UI may show passage snippets for the owner only — keep those here.
  const surfaceEvents = await prisma.analyticsSurfaceEvent.findMany({
    where: { sessionId: id },
    orderBy: { ts: "asc" },
    take: 500,
  });
  const markers = writingMetrics.markersFromSurfaceEvents(surfaceEvents, chunks[0].startedAt);
  const flowLib = require("./analytics-flow.js");
  const stretches = flowLib.detectFlowFromOps(ops, markers);
  const sessionRow = await prisma.analyticsWritingSession.findUnique({
    where: { sessionId: id },
  });
  return {
    ...analyzed,
    contextTag: (sessionRow && sessionRow.contextTag) || "",
    flowStretches: stretches.map((s) => ({
      startMs: s.startMs,
      endMs: s.endMs,
      lengthMs: s.lengthMs,
      startCause: s.startCause,
      endCause: s.endCause,
      startPromptId: (s.startDetail && s.startDetail.promptId) || "",
      endPromptId: (s.endDetail && s.endDetail.promptId) || "",
      startSurfaceId: (s.startDetail && s.startDetail.surfaceId) || "",
      endSurfaceId: (s.endDetail && s.endDetail.surfaceId) || "",
    })),
  };
}

async function ingestSurfaceEvents(rawEvents, sessionUserId) {
  const list = Array.isArray(rawEvents) ? rawEvents.slice(0, MAX_SURFACE_EVENTS) : [];
  let accepted = 0;
  for (const raw of list) {
    const ev = writingMetrics.sanitizeSurfaceEvent(raw);
    if (!ev) continue;
    await prisma.analyticsSurfaceEvent.create({
      data: {
        sessionId: ev.sessionId,
        anonymousId: ev.anonymousId || "",
        userId: sessionUserId || "",
        name: ev.name,
        surfaceId: ev.surfaceId,
        promptId: ev.promptId,
        variantId: ev.variantId,
        position: ev.position,
        ts: ev.ts,
        props: ev.props,
      },
    });
    accepted += 1;
  }
  return { accepted };
}

async function loadSessionBags(userId, since) {
  const chunks = await prisma.analyticsOwnerEditChunk.findMany({
    where: { userId, startedAt: { gte: since } },
    orderBy: [{ sessionId: "asc" }, { chunkIndex: "asc" }],
    take: 5000,
  });
  const bySession = new Map();
  for (const chunk of chunks) {
    if (!bySession.has(chunk.sessionId)) {
      bySession.set(chunk.sessionId, {
        sessionId: chunk.sessionId,
        startedAt: chunk.startedAt,
        ops: [],
        contextTag: "",
        surfaceEvents: [],
      });
    }
    const bag = bySession.get(chunk.sessionId);
    if (chunk.startedAt < bag.startedAt) bag.startedAt = chunk.startedAt;
    const rows = ownerEdit.sanitizeOps(chunk.ops, { allowText: true });
    for (const row of rows) bag.ops.push(row);
  }
  const sessionIds = Array.from(bySession.keys());
  if (!sessionIds.length) return [];

  const sessionRows = await prisma.analyticsWritingSession.findMany({
    where: { sessionId: { in: sessionIds } },
    select: { sessionId: true, contextTag: true },
  });
  for (const row of sessionRows) {
    const bag = bySession.get(row.sessionId);
    if (bag) bag.contextTag = row.contextTag || "";
  }

  const surfaceEvents = await prisma.analyticsSurfaceEvent.findMany({
    where: {
      sessionId: { in: sessionIds },
      ts: { gte: since },
    },
    orderBy: { ts: "asc" },
    take: 10000,
  });
  for (const ev of surfaceEvents) {
    const bag = bySession.get(ev.sessionId);
    if (bag) bag.surfaceEvents.push(ev);
  }

  return Array.from(bySession.values());
}

/** MCP: numbers-only writing metrics for the connector user. */
async function getWritingMetrics(userId, range) {
  const uid = String(userId || "").trim();
  if (!uid) {
    throw Object.assign(new Error("Sign in required."), { status: 401 });
  }
  const parsed = writingMetrics.parseRange(range);
  const since = new Date(Date.now() - parsed.days * 24 * 60 * 60 * 1000);
  const bags = await loadSessionBags(uid, since);
  return writingMetrics.assembleWritingMetrics(bags, parsed.label);
}

/** MCP: list writing sessions (numbers + day + tag; no text). */
async function listWritingSessions(userId, { limit, range } = {}) {
  const uid = String(userId || "").trim();
  if (!uid) {
    throw Object.assign(new Error("Sign in required."), { status: 401 });
  }
  const take = Math.max(1, Math.min(100, Number(limit) || 40));
  const parsed = writingMetrics.parseRange(range || "12w");
  const since = new Date(Date.now() - parsed.days * 24 * 60 * 60 * 1000);
  const bags = await loadSessionBags(uid, since);
  const metrics = writingMetrics.assembleWritingMetrics(bags, parsed.label);
  return {
    range: parsed.label,
    sessions: (metrics.sessions || []).slice(0, take),
  };
}

/** MCP: set a short context tag on a writing session (owner's own only). */
async function tagWritingSession(userId, sessionId, contextTag) {
  const uid = String(userId || "").trim();
  if (!uid) {
    throw Object.assign(new Error("Sign in required."), { status: 401 });
  }
  const id = trimId(sessionId, 80);
  if (!id) {
    throw Object.assign(new Error("sessionId is required."), { status: 400 });
  }
  const tag = trimId(String(contextTag == null ? "" : contextTag), MAX_CONTEXT_TAG);
  // Confirm the session belongs to this user via owner edit chunks or session row.
  const chunk = await prisma.analyticsOwnerEditChunk.findFirst({
    where: { sessionId: id, userId: uid },
    select: { sessionId: true, anonymousId: true, startedAt: true },
  });
  const existing = await prisma.analyticsWritingSession.findUnique({
    where: { sessionId: id },
  });
  if (!chunk && !(existing && existing.userId === uid)) {
    throw Object.assign(new Error("Session not found."), { status: 404 });
  }
  if (existing && existing.userId && existing.userId !== uid) {
    throw Object.assign(new Error("Session not found."), { status: 404 });
  }
  const data = {
    sessionId: id,
    anonymousId: (existing && existing.anonymousId)
      || (chunk && chunk.anonymousId)
      || "",
    userId: uid,
    startedAt: (existing && existing.startedAt)
      || (chunk && chunk.startedAt)
      || new Date(),
    contextTag: tag,
    updatedAt: new Date(),
  };
  await prisma.analyticsWritingSession.upsert({
    where: { sessionId: id },
    create: data,
    update: { contextTag: tag, userId: uid, updatedAt: new Date() },
  });
  return { sessionId: id, contextTag: tag };
}

/**
 * Public build-time export for lindowlabs.dev.
 * Auth is the caller's responsibility (bearer WRITING_SUMMARY_TOKEN).
 * Always scoped to METRICS_OWNER_ALLOWLIST owner ids — never arbitrary users.
 */
async function writingSummaryExport() {
  const owners = Array.from(ownerAllowlist());
  if (!owners.length) {
    return {
      generatedDay: writingMetrics.dayKey(new Date()),
      timeZone: "America/Los_Angeles",
      weekly: [],
      promptRankings: [],
      note: "No owner allowlist configured (METRICS_OWNER_ALLOWLIST / LEADS_OWNER_ALLOWLIST); no owner sessions exported.",
    };
  }
  const since = new Date(Date.now() - 84 * 24 * 60 * 60 * 1000);
  const bags = [];
  for (const ownerId of owners) {
    const ownerBags = await loadSessionBags(ownerId, since);
    for (const b of ownerBags) bags.push(b);
  }
  return writingMetrics.assembleWritingSummary(bags);
}

module.exports = {
  MAX_BATCH,
  KEYSTROKE_RETENTION_MS,
  ownerAllowlist,
  isMetricsOwner,
  isMissingAnalyticsSchema,
  upsertIdentity,
  ingestBatch,
  ingestKeystrokeChunks,
  ingestOwnerEdits,
  ingestSurfaceEvents,
  recomputeWritingSession,
  rollupExpiredKeystrokes,
  loadEventsSince,
  metricsSummary,
  recentEvents,
  sessionTimeline,
  howIWriteOverview,
  howIWriteSession,
  getWritingMetrics,
  listWritingSessions,
  tagWritingSession,
  writingSummaryExport,
};
