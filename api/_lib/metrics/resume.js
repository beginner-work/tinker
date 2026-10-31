/* Resume-metrics queries + persistence helpers (Prisma source of truth).
 *
 * Definitions live in RESUME_METRICS.md. Owner traffic is always excluded.
 */

"use strict";

const events = require("../../../src/renderer/lib/metrics/events.js");
const { newRequestId } = require("../transcribe.js");

function normalizeAnonymousId(raw) {
  const id = String(raw || "").trim().slice(0, 80);
  if (!id) return "";
  if (!/^ra_[a-f0-9]{16,64}$/i.test(id) && !/^rs_anon_/i.test(id)) {
    // Accept any non-empty opaque id from the client; prefix if bare uuid-ish.
    if (/^[a-f0-9-]{16,64}$/i.test(id)) return `ra_${id.replace(/-/g, "").slice(0, 32)}`;
  }
  return id;
}

function normalizeHost(raw) {
  try {
    let h = String(raw || "").trim().toLowerCase();
    if (!h) return "";
    if (h.includes("://")) h = new URL(h).hostname;
    h = h.replace(/^www\./, "");
    return h.slice(0, 200);
  } catch {
    return String(raw || "").trim().toLowerCase().slice(0, 200);
  }
}

async function recordEmbedHost(prismaClient, host) {
  const h = normalizeHost(host);
  if (!h || events.isExcludedEmbedHost(h)) return null;
  if (!prismaClient || typeof prismaClient.readingEmbedHost?.upsert !== "function") {
    return null;
  }
  const now = new Date();
  try {
    return await prismaClient.readingEmbedHost.upsert({
      where: { host: h },
      create: { host: h, firstSeenAt: now, lastSeenAt: now, loadCount: 1 },
      update: { lastSeenAt: now, loadCount: { increment: 1 } },
    });
  } catch (err) {
    console.error("[metrics] embed host upsert failed", err && err.message);
    return null;
  }
}

async function recordEvalRun(prismaClient, row) {
  if (!prismaClient || typeof prismaClient.evalRun?.create !== "function") {
    return null;
  }
  const caseCount = Math.max(0, Math.floor(Number(row.caseCount) || 0));
  let passRate = Number(row.passRate);
  if (!Number.isFinite(passRate)) {
    const passed = Number(row.passedCount);
    passRate = caseCount > 0 && Number.isFinite(passed) ? passed / caseCount : 0;
  }
  passRate = Math.max(0, Math.min(1, passRate));
  try {
    return await prismaClient.evalRun.create({
      data: {
        id: row.id || newRequestId(),
        project: String(row.project || "tinker-ask").slice(0, 120),
        passRate,
        caseCount,
        passedCount: Math.max(0, Math.floor(Number(row.passedCount) || 0)),
        failedCount: Math.max(0, Math.floor(Number(row.failedCount) || 0)),
        experimentUrl: String(row.experimentUrl || "").slice(0, 500),
        report: row.report || {},
      },
    });
  } catch (err) {
    console.error("[metrics] eval run create failed", err && err.message);
    return null;
  }
}

function monthKey(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Resume dashboard payload. Owner rows are always excluded.
 */
async function collectResumeMetrics(prismaClient, { now } = {}) {
  const empty = {
    users: 0,
    questions: 0,
    questionsPerSession: 0,
    repeatUsers: 0,
    embedHosts: [],
    distinctSites: [],
    byPlatform: {},
    latestEvalPassRate: null,
    usersPerMonth: [],
    usersLast30Days: 0,
    generatedAt: (now || new Date()).toISOString(),
  };
  if (!prismaClient) return empty;

  const at = now || new Date();
  const day30 = new Date(at.getTime() - 30 * 24 * 60 * 60 * 1000);

  try {
    const sessions = await prismaClient.readingSession.findMany({
      where: { isOwner: false, anonymousId: { not: "" } },
      select: {
        id: true,
        anonymousId: true,
        createdAt: true,
        questionCount: true,
        companyHost: true,
        platform: true,
      },
    });
    const questions = await prismaClient.readingQuestion.findMany({
      where: { isOwner: false, status: "ok" },
      select: {
        sessionId: true,
        anonymousId: true,
        createdAt: true,
        companyHost: true,
        platform: true,
      },
    });

    const sessionIdsWithQuestion = new Set();
    const usersWithQuestion = new Set();
    for (const q of questions) {
      if (q.sessionId) sessionIdsWithQuestion.add(q.sessionId);
      if (q.anonymousId) usersWithQuestion.add(q.anonymousId);
    }

    // Users: distinct people who started a session AND asked ≥1 question.
    const sessionUsers = new Set();
    const sessionsByUser = new Map();
    let sessionsWithQuestions = 0;
    for (const s of sessions) {
      if (!s.anonymousId) continue;
      sessionUsers.add(s.anonymousId);
      const list = sessionsByUser.get(s.anonymousId) || [];
      list.push(s);
      sessionsByUser.set(s.anonymousId, list);
      if (sessionIdsWithQuestion.has(s.id) || (s.questionCount || 0) > 0) {
        sessionsWithQuestions += 1;
      }
    }
    const users = [...sessionUsers].filter((id) => usersWithQuestion.has(id));
    const userSet = new Set(users);

    const questionCount = questions.filter(
      (q) => !q.anonymousId || userSet.has(q.anonymousId) || sessionIdsWithQuestion.has(q.sessionId),
    ).length;

    // Prefer counting all non-owner ok questions; definition is total questions asked.
    const questionsTotal = questions.length;

    const questionsPerSession =
      sessionsWithQuestions > 0
        ? Math.round((questionsTotal / sessionsWithQuestions) * 100) / 100
        : 0;

    let repeatUsers = 0;
    for (const id of userSet) {
      const list = sessionsByUser.get(id) || [];
      if (list.length >= 2) repeatUsers += 1;
    }

    // usersLast30Days: resume users (session+question) active in last 30 days.
    const users30 = new Set();
    for (const q of questions) {
      if (!q.anonymousId || !userSet.has(q.anonymousId)) continue;
      if (q.createdAt && q.createdAt >= day30) users30.add(q.anonymousId);
    }

    // usersPerMonth: calendar month buckets for resume users by first question.
    const firstQuestionAt = new Map();
    for (const q of questions) {
      if (!q.anonymousId || !userSet.has(q.anonymousId) || !q.createdAt) continue;
      const prev = firstQuestionAt.get(q.anonymousId);
      if (!prev || q.createdAt < prev) firstQuestionAt.set(q.anonymousId, q.createdAt);
    }
    const byMonth = new Map();
    for (const [, when] of firstQuestionAt) {
      const key = monthKey(when);
      byMonth.set(key, (byMonth.get(key) || 0) + 1);
    }
    const usersPerMonth = [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, count]) => ({ month, users: count }));

    let embedHosts = [];
    if (typeof prismaClient.readingEmbedHost?.findMany === "function") {
      const rows = await prismaClient.readingEmbedHost.findMany({
        orderBy: { lastSeenAt: "desc" },
        take: 200,
      });
      embedHosts = rows
        .map((r) => r.host)
        .filter((h) => !events.isExcludedEmbedHost(h));
    }

    let latestEvalPassRate = null;
    if (typeof prismaClient.evalRun?.findFirst === "function") {
      const latest = await prismaClient.evalRun.findFirst({
        orderBy: { createdAt: "desc" },
      });
      if (latest) {
        latestEvalPassRate = {
          passRate: latest.passRate,
          caseCount: latest.caseCount,
          passedCount: latest.passedCount,
          failedCount: latest.failedCount,
          project: latest.project,
          at: latest.createdAt.toISOString(),
          experimentUrl: latest.experimentUrl || "",
        };
      }
    }

    // distinctSites: hostname-only article hosts from non-owner ok questions
    // (falls back to session companyHost). Never full URLs.
    const siteSet = new Set();
    for (const q of questions) {
      const host = normalizeHost(q.companyHost);
      if (host) siteSet.add(host);
    }
    if (siteSet.size === 0) {
      for (const s of sessions) {
        if (!sessionIdsWithQuestion.has(s.id)) continue;
        const host = normalizeHost(s.companyHost);
        if (host) siteSet.add(host);
      }
    }
    const distinctSites = [...siteSet].sort();

    // Platform breakdown (ios / web / android / embed / unknown).
    const byPlatform = {};
    function ensurePlat(p) {
      const key = events.normalizePlatform(p) || "unknown";
      if (!byPlatform[key]) {
        byPlatform[key] = { users: 0, questions: 0, sessions: 0 };
      }
      return key;
    }
    const platUsers = new Map(); // platform -> Set(anonymousId)
    for (const s of sessions) {
      const key = ensurePlat(s.platform);
      byPlatform[key].sessions += 1;
      if (s.anonymousId && userSet.has(s.anonymousId)) {
        if (!platUsers.has(key)) platUsers.set(key, new Set());
        platUsers.get(key).add(s.anonymousId);
      }
    }
    for (const q of questions) {
      const key = ensurePlat(q.platform);
      byPlatform[key].questions += 1;
      if (q.anonymousId && userSet.has(q.anonymousId)) {
        if (!platUsers.has(key)) platUsers.set(key, new Set());
        platUsers.get(key).add(q.anonymousId);
      }
    }
    for (const [key, set] of platUsers) {
      if (byPlatform[key]) byPlatform[key].users = set.size;
    }

    return {
      users: userSet.size,
      questions: questionsTotal,
      questionsPerSession,
      repeatUsers,
      embedHosts,
      distinctSites,
      byPlatform,
      latestEvalPassRate,
      usersPerMonth,
      usersLast30Days: users30.size,
      generatedAt: at.toISOString(),
    };
  } catch (err) {
    console.error("[metrics] collectResumeMetrics failed", err && err.message);
    return empty;
  }
}

module.exports = {
  normalizeAnonymousId,
  normalizeHost,
  recordEmbedHost,
  recordEvalRun,
  collectResumeMetrics,
  monthKey,
};
