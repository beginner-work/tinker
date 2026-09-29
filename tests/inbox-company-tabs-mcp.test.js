/* Company inbox MCP: upsert_target_company, upsert_lead_person, list_target_companies. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("node:module");
const fs = require("node:fs");

process.env.STYTCH_PROJECT_ID = "project-test-company-tabs";
process.env.STYTCH_SECRET = "secret-test-not-real";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
process.env.LEADS_OWNER_ALLOWLIST = "user-a,hunter@example.com";

let seq = 0;
const tables = {};
function model() {
  const rows = [];
  return {
    rows,
    async create({ data }) {
      const now = new Date(Date.UTC(2026, 8, 29, 20, 0, ++seq));
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
for (const name of [
  "lead", "leadDraft", "leadEvent", "tinkerUserData", "targetCompany", "outreachTouch", "outreachSession",
]) tables[name] = model();
const database = {
  $executeRawUnsafe: async () => 0,
  $transaction: async (fn) => fn(database),
  lead: tables.lead, leadDraft: tables.leadDraft, leadEvent: tables.leadEvent,
  tinkerUserData: tables.tinkerUserData, targetCompany: tables.targetCompany,
  outreachTouch: tables.outreachTouch, outreachSession: tables.outreachSession,
};
function stubAt(absPath, exports) {
  const mod = new Module(absPath);
  mod.filename = absPath; mod.loaded = true; mod.exports = exports;
  require.cache[absPath] = mod;
}
const libDir = path.resolve(__dirname, "..", "api", "_lib");
const apiDir = path.resolve(__dirname, "..", "api");
for (const rel of [
  "db.js", "stytch.js", "mcp-keys.js", "leads-store.js", "leads-companies-store.js",
  "outreach-schedule-store.js", "self-thread-store.js",
]) delete require.cache[path.join(libDir, rel)];
delete require.cache[path.join(apiDir, "mcp.js")];
stubAt(path.join(libDir, "stytch.js"), {
  authenticateSession: async (token) => {
    if (token !== "user-a") throw Object.assign(new Error("nope"), { status: 401 });
    return { session: { user_id: token }, user: { user_id: token, emails: [{ email: "hunter@example.com" }] } };
  },
});
stubAt(path.join(libDir, "db.js"), database);
stubAt(path.join(libDir, "mcp-keys.js"), {
  isMcpApiKey: (t) => typeof t === "string" && t.startsWith("mcp_"),
  authenticateMcpKey: async (token) => {
    if (token === "mcp_" + "a".repeat(43)) return { id: "k1", label: "bot", userId: "user-a" };
    throw Object.assign(new Error("Invalid API key."), { status: 401 });
  },
  userIdFromSession: (s) => (s && s.session && s.session.user_id) || "",
});
const mcp = require("../api/mcp.js");
const companies = require("../api/_lib/leads-companies-store.js");
const leads = require("../api/_lib/leads-store.js");
const schedule = require("../api/_lib/outreach-schedule-store.js");
function fakeRes() {
  const captured = { status: null, body: null, headers: {} };
  return {
    captured,
    setHeader(k, v) { captured.headers[String(k).toLowerCase()] = v; },
    status(c) { captured.status = c; return this; },
    json(p) { captured.body = p; return this; },
    end() { return this; },
  };
}
async function mcpCall(name, args) {
  const res = fakeRes();
  await mcp({
    method: "POST", url: "/api/mcp",
    headers: { authorization: "Bearer " + "mcp_" + "a".repeat(43) },
    body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } },
  }, res);
  return res.captured;
}
test.beforeEach(() => {
  seq = 0;
  for (const table of Object.values(tables)) table.rows.length = 0;
  companies.resetTableCache();
  leads.resetTableCache();
  schedule.resetTableCache();
});
test("upsert_target_company and list_target_companies", async () => {
  const created = await mcpCall("upsert_target_company", {
    name: "Stripe", priority: 1, tier: "north_star", notes: "Primary chase",
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.result.isError, undefined);
  assert.equal(created.body.result.structuredContent.company.tier, "north_star");
  assert.equal(created.body.result.structuredContent.company.northStar, true);
  await mcpCall("upsert_target_company", { name: "Notion", priority: 2, tier: "wave_1" });
  const listed = await mcpCall("list_target_companies", {});
  assert.equal(listed.body.result.structuredContent.companies.length, 2);
  assert.equal(listed.body.result.structuredContent.companies[0].company.name, "Stripe");
});
test("upsert_lead_person attaches people under a company", async () => {
  const person = await mcpCall("upsert_lead_person", {
    personName: "Morgan Kim",
    companyName: "Stripe",
    contactType: "referrer",
    personTitle: "EM",
    nextStep: "Referral intro",
    dueDate: "2026-09-30T15:00:00.000Z",
    queueOrder: 0,
    touchType: "referral_outreach",
    tier: "north_star",
    companyPriority: 1,
  });
  assert.equal(person.status, 200);
  assert.equal(person.body.result.isError, undefined);
  assert.equal(person.body.result.structuredContent.lead.contactType, "referrer");
  assert.equal(person.body.result.structuredContent.touch.touchType, "referral_outreach");
  const listed = await mcpCall("list_target_companies", {});
  assert.equal(listed.body.result.structuredContent.companies[0].people.length, 1);
  assert.equal(listed.body.result.structuredContent.companies[0].people[0].personName, "Morgan Kim");
});
test("shell is company-level with person tabs and demos omit GTM", () => {
  const shell = fs.readFileSync(path.join(__dirname, "..", "src/renderer/messages-shell.js"), "utf8");
  assert.match(shell, /selectCompany/);
  assert.match(shell, /renderPersonTabs/);
  assert.match(shell, /data-company-id/);
  const demo = fs.readFileSync(path.join(__dirname, "..", "src/renderer/messages/demo-you.html"), "utf8");
  assert.equal(/Your GTM approach/i.test(demo), false);
  assert.match(demo, /sitting here at home/);
  assert.match(demo, /Tyler Lindow/);
});
