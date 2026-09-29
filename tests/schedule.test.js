/* TYL-64 outreach schedule API + MCP read. Postgres stubbed. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
process.env.STYTCH_PROJECT_ID = "project-test-schedule";
process.env.STYTCH_SECRET = "secret-test-not-real";
process.env.LEADS_OWNER_ALLOWLIST = "user-a,hunter@example.com,user-b,other@example.com";
let seq = 0;
const tables = {};
function model() {
  const rows = [];
  return {
    rows,
    async create({ data }) {
      const now = new Date(Date.UTC(2026, 8, 29, 14, 0, ++seq));
      const row = Object.assign({ id: "row_" + seq, createdAt: now, updatedAt: now }, data);
      rows.push(row);
      return row;
    },
    async findUnique({ where }) {
      if (where.id) return rows.find((row) => row.id === where.id) || null;
      const pair = where.userId_kind;
      if (pair) return rows.find((row) => row.userId === pair.userId && row.kind === pair.kind) || null;
      return null;
    },
    async findMany({ where = {} } = {}) {
      return rows.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
    },
    async update({ where, data }) {
      const row = rows.find((item) => item.id === where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    async upsert({ where, create, update }) {
      const pair = where.userId_kind;
      const row = rows.find((item) => item.userId === pair.userId && item.kind === pair.kind);
      if (!row) return this.create({ data: create });
      Object.assign(row, update, { updatedAt: new Date() });
      return row;
    },
  };
}
for (const name of ["lead", "leadDraft", "leadEvent", "tinkerUserData", "targetCompany", "outreachTouch", "outreachSession"]) tables[name] = model();
const database = {
  $executeRawUnsafe: async () => 0, $transaction: async (fn) => fn(database),
  lead: tables.lead, leadDraft: tables.leadDraft, leadEvent: tables.leadEvent, tinkerUserData: tables.tinkerUserData,
  targetCompany: tables.targetCompany, outreachTouch: tables.outreachTouch, outreachSession: tables.outreachSession,
};
function stubAt(absPath, exports) {
  const mod = new Module(absPath);
  mod.filename = absPath; mod.loaded = true; mod.exports = exports;
  require.cache[absPath] = mod;
}
const libDir = path.resolve(__dirname, "..", "api", "_lib");
stubAt(path.join(libDir, "stytch.js"), {
  authenticateSession: async (token) => {
    if (token !== "user-a" && token !== "user-b") throw Object.assign(new Error("nope"), { status: 401 });
    const email = token === "user-a" ? "hunter@example.com" : "other@example.com";
    return { session: { user_id: token }, user: { user_id: token, emails: [{ email }] } };
  },
});
stubAt(path.join(libDir, "db.js"), database);
stubAt(path.join(libDir, "mcp-keys.js"), {
  isMcpApiKey: (token) => typeof token === "string" && token.startsWith("mcp_"),
  authenticateMcpKey: async (token) => {
    if (token === "mcp_user_a") return { userId: "user-a" };
    if (token === "mcp_user_b") return { userId: "user-b" };
    throw Object.assign(new Error("bad key"), { status: 401 });
  },
  userIdFromSession: (session) => (session && session.session && session.session.user_id) || "",
});
for (const rel of ["../api/_lib/leads-store.js", "../api/_lib/leads-companies-store.js", "../api/_lib/outreach-schedule-store.js", "../api/schedule.js", "../api/leads.js", "../api/mcp.js"]) {
  delete require.cache[require.resolve(rel)];
}
const scheduleStore = require("../api/_lib/outreach-schedule-store.js");
const companies = require("../api/_lib/leads-companies-store.js");
const leadsStore = require("../api/_lib/leads-store.js");
const handler = require("../api/schedule.js");
const leadsHandler = require("../api/leads.js");
const mcp = require("../api/mcp.js");
function resCap() {
  const captured = { status: null, body: null, headers: {} };
  return {
    captured,
    setHeader(k, v) { captured.headers[String(k).toLowerCase()] = v; },
    status(c) { captured.status = c; return this; },
    json(p) { captured.body = p; return this; },
    send(p) { captured.body = p; return this; },
    end(p) { if (p != null) captured.body = p; return this; },
  };
}
async function call(api, { method, token = "user-a", action, body, query }) {
  const captured = resCap();
  await api({ method, url: "/api", headers: { authorization: token ? "Bearer " + token : "" }, body, query: Object.assign({ action }, query || {}) }, captured);
  return captured.captured;
}
test.beforeEach(() => {
  seq = 0;
  for (const table of Object.values(tables)) table.rows.length = 0;
  scheduleStore.resetTableCache(); companies.resetTableCache(); leadsStore.resetTableCache();
  process.env.LEADS_OWNER_ALLOWLIST = "user-a,hunter@example.com,user-b,other@example.com";
});
test("migration, week view, skill rules, cross-owner, and MCP read", async () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma/migrations/20260929090000_outreach_schedule/migration.sql"), "utf8");
  for (const statement of scheduleStore.TABLE_STATEMENTS) assert.ok(sql.includes(statement));
  const settings = await call(leadsHandler, { method: "POST", action: "settings", body: { curriculumName: "My system design track" } });
  assert.equal(settings.body.settings.curriculumName, "My system design track");
  const acme = await call(leadsHandler, { method: "POST", action: "company", body: { name: "Acme", northStar: true } });
  const orbit = await call(leadsHandler, { method: "POST", action: "company", body: { name: "Orbit" } });
  assert.equal((await call(handler, { method: "POST", action: "session", body: { type: "skill", title: "Build auth", startsAt: "2026-09-28T15:00:00.000Z", endsAt: "2026-09-28T17:00:00.000Z" } })).status, 400);
  const skill = await call(handler, { method: "POST", action: "session", body: { type: "skill", title: "Build auth", startsAt: "2026-09-28T15:00:00.000Z", endsAt: "2026-09-28T17:00:00.000Z", productArea: "auth", concept: "sessions", curriculumRef: "My system design track / week 3" } });
  assert.equal(skill.status, 201);
  const companySession = await call(handler, { method: "POST", action: "session", body: { type: "company", title: "Tinker on Acme: recruiter note", startsAt: "2026-09-29T16:00:00.000Z", endsAt: "2026-09-29T17:00:00.000Z" } });
  const touch = await call(handler, { method: "POST", action: "touch", body: { companyId: acme.body.company.id, touchType: "recruiter_outreach", date: "2026-09-29T00:00:00.000Z", windowStart: "09:00", windowEnd: "11:00", sessionId: companySession.body.session.id } });
  assert.equal(touch.status, 201);
  const week = await call(handler, { method: "GET", action: "week", query: { weekStart: "2026-09-29" } });
  assert.equal(week.body.northStar.id, acme.body.company.id);
  assert.equal(week.body.companiesMissingTouch.some((row) => row.id === orbit.body.company.id), true);
  assert.equal(week.body.sessions.find((row) => row.session.type === "company").touches[0].touch.touchType, "recruiter_outreach");
  assert.equal((await call(handler, { method: "GET", token: "user-b", action: "week", query: { weekStart: "2026-09-29" } })).body.sessions.length, 0);
  assert.equal((await call(handler, { method: "PATCH", token: "user-b", action: "touch", body: { id: touch.body.touch.id, status: "done" } })).status, 404);
  assert.equal((await call(handler, { method: "PATCH", token: "user-b", action: "session", body: { id: companySession.body.session.id, title: "Nope" } })).status, 404);
  const other = resCap();
  await mcp({ method: "POST", headers: { authorization: "Bearer mcp_user_b", "content-type": "application/json" }, body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_outreach_schedule", arguments: { weekStart: "2026-09-29", userId: "user-a" } } } }, other);
  assert.equal(other.captured.body.result.structuredContent.sessions.length, 0);
  const own = resCap();
  await mcp({ method: "POST", headers: { authorization: "Bearer mcp_user_a", "content-type": "application/json" }, body: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_outreach_schedule", arguments: { weekStart: "2026-09-29", touchType: "recruiter_outreach" } } } }, own);
  assert.equal(own.captured.body.result.structuredContent.sessions[1].touches.length, 1);
  assert.match(week.body.sessions[1].googleCalendarUrl, /calendar\.google\.com/);
  assert.equal(week.body.calendarReadEnabled, false);
  assert.deepEqual(week.body.busyEvents, []);
  const exported = await call(handler, { method: "GET", action: "export", query: { weekStart: "2026-09-29" } });
  assert.equal(exported.status, 200);
  assert.match(String(exported.body), /BEGIN:VCALENDAR/);
  assert.match(String(exported.body), /Tinker on Acme/);
  assert.equal((await call(handler, { method: "GET", token: "user-b", action: "export", query: { weekStart: "2026-09-29" } })).body.includes("Tinker on Acme"), false);
});
