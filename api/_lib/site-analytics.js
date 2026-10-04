/* Cookieless page-view analytics for lindowlabs.dev.
 *
 * Stores only path, referrer hostname, two utm fields, and an ISO week.
 * No IP, user agent, cookies, full referrer URL, or query strings.
 */

"use strict";

const prisma = require("./db.js");

const ALLOWED_ORIGINS = new Set([
  "https://lindowlabs.dev",
  "https://www.lindowlabs.dev",
]);

const MAX_PATH = 200;
const MAX_REF = 120;
const MAX_UTM = 64;
const MAX_BODY_BYTES = 4 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 120;

/** In-memory abuse cap (per warm isolate). Keyed by a short request fingerprint; never persisted. */
const rateBuckets = new Map();

const BOT_UA =
  /bot|spider|crawl|slurp|facebookexternalhit|preview|monitor|pingdom|uptimerobot|headless|wget|curl|python-requests|scrapy|httpclient/i;

function isAllowedOrigin(origin) {
  if (!origin || typeof origin !== "string") return false;
  return ALLOWED_ORIGINS.has(origin.trim());
}

function applyCors(req, res) {
  const origin = String((req.headers && req.headers.origin) || "").trim();
  if (isAllowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
}

function corsPreflight(req, res, methods) {
  applyCors(req, res);
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.status(204).end();
}

function trimStr(value, max) {
  if (typeof value !== "string") return "";
  const t = value.trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max) : t;
}

/** Strip query/hash, force leading slash, collapse trailing slash (except root), cap length. */
function normalizePath(raw) {
  let s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "/";
  const q = s.indexOf("?");
  if (q >= 0) s = s.slice(0, q);
  const h = s.indexOf("#");
  if (h >= 0) s = s.slice(0, h);
  if (!s.startsWith("/")) s = `/${s}`;
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  // Reject path traversal / weird schemes that slipped in.
  if (s.includes("://") || s.includes("..")) return "/";
  if (s.length > MAX_PATH) s = s.slice(0, MAX_PATH);
  return s || "/";
}

/** Referrer hostname only — never a full URL. */
function normalizeRef(raw) {
  let s = trimStr(raw, MAX_REF).toLowerCase();
  if (!s) return "";
  if (s.includes("://")) {
    try {
      s = new URL(s).hostname || "";
    } catch {
      s = "";
    }
  }
  s = s.replace(/^www\./, "");
  // Drop path leftovers if a bare host/path was sent.
  const slash = s.indexOf("/");
  if (slash >= 0) s = s.slice(0, slash);
  return trimStr(s, MAX_REF);
}

function normalizeUtm(raw) {
  return trimStr(raw, MAX_UTM).toLowerCase();
}

/** Preferred source order for /api/site/visitors. */
const SOURCE_ORDER = ["LinkedIn", "Email", "GitHub", "Tinker", "Direct", "Other"];

function isTinkerRef(ref) {
  const r = String(ref || "").toLowerCase();
  if (!r) return false;
  return r === "beginner.work" || r.endsWith(".beginner.work");
}

/** Map ref + utm into LinkedIn | Email | GitHub | Tinker | Direct | Other. */
function mapSource(ref, utmSource) {
  const r = String(ref || "").toLowerCase();
  const u = String(utmSource || "").toLowerCase();
  if (u.includes("linkedin") || r.includes("linkedin")) return "LinkedIn";
  if (
    u === "email" ||
    u.includes("newsletter") ||
    u.includes("mail") ||
    r.startsWith("mail.") ||
    r.includes("mail.")
  ) {
    return "Email";
  }
  if (u.includes("github") || r.includes("github")) return "GitHub";
  if (u === "tinker" || isTinkerRef(r)) return "Tinker";
  if (!r && !u) return "Direct";
  return "Other";
}

/** ISO week key like 2026-W40 (UTC). */
function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function isMissingSiteSchema(err) {
  if (!err) return false;
  const code = String(err.code || "");
  if (code === "P2021") return true;
  const msg = String(err.message || err);
  if (/P2021\b/.test(msg)) return true;
  if (/does not exist/i.test(msg) && /(relation|table|SitePageView)/i.test(msg)) {
    return true;
  }
  return false;
}

function emptyVisitorsPayload() {
  return {
    since: null,
    weeks: [],
    sources: [],
    pages: [],
    funnel: { resume: 0, explore: 0, schedule_time: 0, booked: null },
  };
}

function isObviousBot(ua) {
  const s = String(ua || "");
  if (!s) return false;
  return BOT_UA.test(s);
}

function clientFingerprint(req) {
  // Used only for the in-memory rate bucket — never written to the DB.
  const xf = String((req.headers && (req.headers["x-forwarded-for"] || req.headers["x-real-ip"])) || "");
  const first = xf.split(",")[0].trim();
  if (first) return `ip:${first.slice(0, 64)}`;
  return "ip:unknown";
}

function rateLimitExceeded(req) {
  const key = clientFingerprint(req);
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start >= RATE_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  // Opportunistic cleanup of stale keys.
  if (rateBuckets.size > 5_000) {
    for (const [k, v] of rateBuckets) {
      if (now - v.start >= RATE_WINDOW_MS) rateBuckets.delete(k);
    }
  }
  return bucket.count > RATE_MAX_PER_WINDOW;
}

function sanitizePingBody(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const path = normalizePath(raw.path);
  const ref = normalizeRef(raw.ref);
  const utmSource = normalizeUtm(raw.utm_source);
  const utmCampaign = normalizeUtm(raw.utm_campaign);
  // Reject unknown oversized payloads by ignoring unexpected giant strings already capped;
  // require a path-like value (always normalized to at least "/").
  return {
    path,
    ref,
    utmSource,
    utmCampaign,
    source: mapSource(ref, utmSource),
    week: isoWeekKey(),
  };
}

function parseBodyText(text) {
  const raw = String(text || "").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readRequestBody(req) {
  if (req.body != null) {
    if (typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
      return Promise.resolve({ ok: true, value: req.body });
    }
    if (typeof req.body === "string" || Buffer.isBuffer(req.body)) {
      const parsed = parseBodyText(req.body);
      if (parsed == null) return Promise.resolve({ ok: false, reason: "invalid_json" });
      return Promise.resolve({ ok: true, value: parsed });
    }
  }
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        finish({ ok: false, reason: "too_large" });
        try { req.destroy(); } catch { /* ignore */ }
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const parsed = parseBodyText(raw);
      if (parsed == null) return finish({ ok: false, reason: "invalid_json" });
      finish({ ok: true, value: parsed });
    });
    req.on("error", () => finish({ ok: false, reason: "read_error" }));
  });
}

async function recordPing(event) {
  await prisma.sitePageView.create({
    data: {
      path: event.path,
      ref: event.ref,
      utmSource: event.utmSource,
      utmCampaign: event.utmCampaign,
      source: event.source,
      week: event.week,
    },
  });
}

function funnelBucket(path) {
  const p = normalizePath(path);
  if (p === "/resume") return "resume";
  if (p === "/schedule-time") return "schedule_time";
  if (
    p === "/" ||
    p === "/visitors" ||
    p === "/learning" ||
    p === "/blog" ||
    p.startsWith("/blog/")
  ) {
    return "explore";
  }
  return null;
}

function sortByViewsDesc(rows) {
  return rows.sort((a, b) => b.views - a.views || String(a.path || a.source || a.week)
    .localeCompare(String(b.path || b.source || b.week)));
}

/** Stable source order: LinkedIn, Email, GitHub, Tinker, Direct, Other. */
function sortSources(rows) {
  const rank = new Map(SOURCE_ORDER.map((name, i) => [name, i]));
  return rows.sort((a, b) => {
    const ra = rank.has(a.source) ? rank.get(a.source) : SOURCE_ORDER.length;
    const rb = rank.has(b.source) ? rank.get(b.source) : SOURCE_ORDER.length;
    if (ra !== rb) return ra - rb;
    return b.views - a.views;
  });
}

async function visitorsSummary() {
  const rows = await prisma.sitePageView.findMany({
    select: {
      path: true,
      source: true,
      week: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (!rows.length) return emptyVisitorsPayload();

  const sinceDate = rows[0].createdAt;
  const since = sinceDate instanceof Date
    ? sinceDate.toISOString().slice(0, 10)
    : String(sinceDate).slice(0, 10);

  const weekMap = new Map();
  const sourceMap = new Map();
  const pageMap = new Map();
  const funnel = { resume: 0, explore: 0, schedule_time: 0, booked: null };

  for (const row of rows) {
    const week = String(row.week || "");
    weekMap.set(week, (weekMap.get(week) || 0) + 1);
    const source = String(row.source || "Other") || "Other";
    sourceMap.set(source, (sourceMap.get(source) || 0) + 1);
    const path = normalizePath(row.path);
    pageMap.set(path, (pageMap.get(path) || 0) + 1);
    const bucket = funnelBucket(path);
    if (bucket === "resume") funnel.resume += 1;
    else if (bucket === "explore") funnel.explore += 1;
    else if (bucket === "schedule_time") funnel.schedule_time += 1;
  }

  const weeks = sortByViewsDesc(
    [...weekMap.entries()].map(([week, views]) => ({ week, views })),
  ).sort((a, b) => String(a.week).localeCompare(String(b.week)));
  const sources = sortSources(
    [...sourceMap.entries()].map(([source, views]) => ({ source, views })),
  );
  const pages = sortByViewsDesc(
    [...pageMap.entries()].map(([path, views]) => ({ path, views })),
  );

  return { since, weeks, sources, pages, funnel };
}

/** Test helper — clear rate buckets between cases. */
function _resetRateLimitForTests() {
  rateBuckets.clear();
}

module.exports = {
  ALLOWED_ORIGINS,
  MAX_BODY_BYTES,
  applyCors,
  corsPreflight,
  normalizePath,
  normalizeRef,
  normalizeUtm,
  mapSource,
  isoWeekKey,
  isMissingSiteSchema,
  emptyVisitorsPayload,
  isObviousBot,
  rateLimitExceeded,
  sanitizePingBody,
  readRequestBody,
  recordPing,
  funnelBucket,
  visitorsSummary,
  isAllowedOrigin,
  SOURCE_ORDER,
  sortSources,
  _resetRateLimitForTests,
};
