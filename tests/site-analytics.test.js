/* Site analytics for lindowlabs.dev — CORS, privacy, missing-table fallback. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const site = require("../api/_lib/site-analytics.js");

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(n) { this.statusCode = n; return this; },
    json(b) { this.body = b; return this; },
    end() { this.ended = true; return this; },
  };
}

test("normalizePath strips query/hash, caps length, forces slash", () => {
  assert.equal(site.normalizePath("/resume?x=1#top"), "/resume");
  assert.equal(site.normalizePath("blog/hello/"), "/blog/hello");
  assert.equal(site.normalizePath(""), "/");
  assert.equal(site.normalizePath("../etc/passwd"), "/");
  assert.equal(site.normalizePath("https://evil.example/x"), "/");
  const long = `/${"a".repeat(500)}`;
  assert.equal(site.normalizePath(long).length, site.normalizePath("/" + "a".repeat(199)).length);
  assert.ok(site.normalizePath(long).length <= 200);
});

test("normalizeRef keeps hostname only", () => {
  assert.equal(site.normalizeRef("https://www.linkedin.com/in/x?foo=1"), "linkedin.com");
  assert.equal(site.normalizeRef("github.com"), "github.com");
  assert.equal(site.normalizeRef(""), "");
});

test("mapSource buckets LinkedIn Email GitHub Direct Other", () => {
  assert.equal(site.mapSource("linkedin.com", ""), "LinkedIn");
  assert.equal(site.mapSource("", "linkedin"), "LinkedIn");
  assert.equal(site.mapSource("", "email"), "Email");
  assert.equal(site.mapSource("mail.google.com", ""), "Email");
  assert.equal(site.mapSource("github.com", ""), "GitHub");
  assert.equal(site.mapSource("", "github"), "GitHub");
  assert.equal(site.mapSource("", ""), "Direct");
  assert.equal(site.mapSource("news.ycombinator.com", ""), "Other");
});

test("funnel buckets match resume / explore / schedule_time", () => {
  assert.equal(site.funnelBucket("/resume"), "resume");
  assert.equal(site.funnelBucket("/resume/"), "resume");
  assert.equal(site.funnelBucket("/"), "explore");
  assert.equal(site.funnelBucket("/blog"), "explore");
  assert.equal(site.funnelBucket("/blog/hello"), "explore");
  assert.equal(site.funnelBucket("/visitors"), "explore");
  assert.equal(site.funnelBucket("/learning"), "explore");
  assert.equal(site.funnelBucket("/schedule-time"), "schedule_time");
  assert.equal(site.funnelBucket("/other"), null);
});

test("emptyVisitorsPayload uses the resume/explore funnel shape", () => {
  const empty = site.emptyVisitorsPayload();
  assert.deepEqual(empty, {
    since: null,
    weeks: [],
    sources: [],
    pages: [],
    funnel: { resume: 0, explore: 0, schedule_time: 0, booked: null },
  });
});

test("isoWeekKey looks like YYYY-Www", () => {
  assert.match(site.isoWeekKey(new Date("2026-10-04T12:00:00Z")), /^2026-W\d{2}$/);
});

test("isObviousBot matches crawlers without needing UA storage", () => {
  assert.equal(site.isObviousBot("Mozilla/5.0 (compatible; Googlebot/2.1)"), true);
  assert.equal(site.isObviousBot("curl/8.0"), true);
  assert.equal(site.isObviousBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"), false);
});

test("sanitizePingBody never keeps IP/UA and only privacy-safe fields", () => {
  const event = site.sanitizePingBody({
    path: "/resume?secret=1",
    ref: "https://www.linkedin.com/in/someone",
    utm_source: "linkedin",
    utm_campaign: "spring",
    ip: "1.2.3.4",
    userAgent: "Mozilla/5.0",
    cookie: "session=abc",
    full_url: "https://lindowlabs.dev/resume?x=1",
  });
  assert.ok(event);
  assert.equal(event.path, "/resume");
  assert.equal(event.ref, "linkedin.com");
  assert.equal(event.utmSource, "linkedin");
  assert.equal(event.utmCampaign, "spring");
  assert.equal(event.source, "LinkedIn");
  assert.match(event.week, /^\d{4}-W\d{2}$/);
  assert.equal(Object.prototype.hasOwnProperty.call(event, "ip"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(event, "userAgent"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(event, "cookie"), false);
});

test("CORS allows only lindowlabs.dev origins on OPTIONS ping", async () => {
  const handler = require("../api/site/ping.js");
  const allowed = mockRes();
  await handler({
    method: "OPTIONS",
    headers: { origin: "https://lindowlabs.dev" },
    url: "/api/site/ping",
  }, allowed);
  assert.equal(allowed.statusCode, 204);
  assert.equal(allowed.headers["access-control-allow-origin"], "https://lindowlabs.dev");
  assert.match(String(allowed.headers["access-control-allow-methods"] || ""), /POST/);

  const www = mockRes();
  await handler({
    method: "OPTIONS",
    headers: { origin: "https://www.lindowlabs.dev" },
    url: "/api/site/ping",
  }, www);
  assert.equal(www.headers["access-control-allow-origin"], "https://www.lindowlabs.dev");

  const denied = mockRes();
  await handler({
    method: "OPTIONS",
    headers: { origin: "https://evil.example" },
    url: "/api/site/ping",
  }, denied);
  assert.equal(denied.statusCode, 204);
  assert.equal(denied.headers["access-control-allow-origin"], undefined);
});

test("CORS allows only lindowlabs.dev origins on OPTIONS visitors", async () => {
  const handler = require("../api/site/visitors.js");
  const allowed = mockRes();
  await handler({
    method: "OPTIONS",
    headers: { origin: "https://www.lindowlabs.dev" },
    url: "/api/site/visitors",
  }, allowed);
  assert.equal(allowed.statusCode, 204);
  assert.equal(allowed.headers["access-control-allow-origin"], "https://www.lindowlabs.dev");
  assert.match(String(allowed.headers["access-control-allow-methods"] || ""), /GET/);
});

test("POST ping returns 204 and drops when SitePageView table is missing", async () => {
  const prev = site.recordPing;
  site.recordPing = async () => {
    const err = new Error('relation "SitePageView" does not exist');
    err.code = "P2021";
    throw err;
  };
  // Handler closes over site.recordPing via require of module — stub on exports used by handler.
  // ping.js requires the lib once; re-stub through the same module object.
  const handlerPath = require.resolve("../api/site/ping.js");
  delete require.cache[handlerPath];
  const handler = require("../api/site/ping.js");

  const res = mockRes();
  await handler({
    method: "POST",
    headers: {
      origin: "https://lindowlabs.dev",
      "user-agent": "Mozilla/5.0",
      "content-type": "application/json",
    },
    url: "/api/site/ping",
    body: { path: "/resume", ref: "linkedin.com", utm_source: "linkedin", utm_campaign: "" },
  }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
  assert.equal(res.body, null);
  site.recordPing = prev;
  delete require.cache[handlerPath];
});

test("POST ping accepts text/plain sendBeacon bodies", async () => {
  const created = [];
  const prev = site.recordPing;
  site.recordPing = async (event) => { created.push(event); };
  const handlerPath = require.resolve("../api/site/ping.js");
  delete require.cache[handlerPath];
  const handler = require("../api/site/ping.js");

  const res = mockRes();
  await handler({
    method: "POST",
    headers: {
      origin: "https://lindowlabs.dev",
      "user-agent": "Mozilla/5.0",
      "content-type": "text/plain;charset=UTF-8",
    },
    url: "/api/site/ping",
    body: JSON.stringify({
      path: "/blog/hello",
      ref: "github.com",
      utm_source: "",
      utm_campaign: "",
    }),
  }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(created.length, 1);
  assert.equal(created[0].path, "/blog/hello");
  assert.equal(created[0].source, "GitHub");
  assert.equal(Object.prototype.hasOwnProperty.call(created[0], "ip"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(created[0], "userAgent"), false);
  site.recordPing = prev;
  delete require.cache[handlerPath];
});

test("POST ping soft-drops obvious bots without calling recordPing", async () => {
  let called = 0;
  const prev = site.recordPing;
  site.recordPing = async () => { called += 1; };
  const handlerPath = require.resolve("../api/site/ping.js");
  delete require.cache[handlerPath];
  const handler = require("../api/site/ping.js");
  const res = mockRes();
  await handler({
    method: "POST",
    headers: {
      origin: "https://lindowlabs.dev",
      "user-agent": "Googlebot/2.1",
    },
    url: "/api/site/ping",
    body: { path: "/" },
  }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(called, 0);
  site.recordPing = prev;
  delete require.cache[handlerPath];
});

test("GET visitors returns empty funnel when table is missing", async () => {
  const prev = site.visitorsSummary;
  site.visitorsSummary = async () => {
    const err = new Error("The table `public.SitePageView` does not exist in the current database.");
    err.code = "P2021";
    throw err;
  };
  const handlerPath = require.resolve("../api/site/visitors.js");
  delete require.cache[handlerPath];
  const handler = require("../api/site/visitors.js");

  const res = mockRes();
  await handler({
    method: "GET",
    headers: { origin: "https://lindowlabs.dev" },
    url: "/api/site/visitors",
  }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    since: null,
    weeks: [],
    sources: [],
    pages: [],
    funnel: { resume: 0, explore: 0, schedule_time: 0, booked: null },
  });
  assert.equal(res.headers["access-control-allow-origin"], "https://lindowlabs.dev");
  assert.match(String(res.headers["cache-control"] || ""), /s-maxage=300/);
  site.visitorsSummary = prev;
  delete require.cache[handlerPath];
});

test("visitorsSummary aggregates weeks sources pages and funnel", async () => {
  const prisma = require("../api/_lib/db.js");
  const prev = prisma.sitePageView;
  prisma.sitePageView = {
    findMany: async () => ([
      { path: "/resume", source: "LinkedIn", week: "2026-W40", createdAt: new Date("2026-09-28T10:00:00Z") },
      { path: "/", source: "Direct", week: "2026-W40", createdAt: new Date("2026-09-28T11:00:00Z") },
      { path: "/blog/x", source: "GitHub", week: "2026-W41", createdAt: new Date("2026-10-05T10:00:00Z") },
      { path: "/visitors", source: "Other", week: "2026-W41", createdAt: new Date("2026-10-05T11:00:00Z") },
      { path: "/learning", source: "Email", week: "2026-W41", createdAt: new Date("2026-10-05T12:00:00Z") },
      { path: "/schedule-time", source: "LinkedIn", week: "2026-W41", createdAt: new Date("2026-10-05T13:00:00Z") },
    ]),
  };
  const summary = await site.visitorsSummary();
  assert.equal(summary.since, "2026-09-28");
  assert.deepEqual(summary.funnel, {
    resume: 1,
    explore: 4,
    schedule_time: 1,
    booked: null,
  });
  assert.equal(summary.weeks.length, 2);
  assert.equal(summary.pages.find((p) => p.path === "/resume").views, 1);
  assert.equal(summary.sources.find((s) => s.source === "LinkedIn").views, 2);
  prisma.sitePageView = prev;
});

test("migration and schema declare SitePageView; build stays generate-only", () => {
  const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  assert.match(schema, /model SitePageView/);
  assert.match(schema, /utmSource/);
  assert.match(schema, /utmCampaign/);
  const sql = fs.readFileSync(
    path.join(__dirname, "..", "prisma", "migrations", "20261004220000_site_page_views", "migration.sql"),
    "utf8",
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS "SitePageView"/);
  const vercel = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vercel.json"), "utf8"));
  assert.equal(vercel.buildCommand, "prisma generate");
  assert.doesNotMatch(vercel.buildCommand, /migrate/);
});

test("isMissingSiteSchema detects P2021 for SitePageView", () => {
  assert.equal(site.isMissingSiteSchema({ code: "P2021" }), true);
  assert.equal(site.isMissingSiteSchema({ message: 'relation "SitePageView" does not exist' }), true);
  assert.equal(site.isMissingSiteSchema({ code: "P2002", message: "unique" }), false);
});
