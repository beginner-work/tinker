/* TYL-65: MCP set_company_priority + plan_lead_touch structure the inbox. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("node:module");
const fs = require("node:fs");

process.env.STYTCH_PROJECT_ID = "project-test-inbox-plan";
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
      const now = new Date(Date.UTC(2026, 8, 29, 15, 0, ++seq));
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
  lead: tables.lead,
  leadDraft: tables.leadDraft,
  leadEvent: tables.leadEvent,
  tinkerUserData: tables.tinkerUserData,
  targetCompany: tables.targetCompany,
  outreachTouch: tables.outreachTouch,
  outreachSession: tables.outreachSession,
};

function stubAt(absPath, exports) {
  const mod = new Module(absPath);
  mod.filename = absPath;
  mod.loaded = true;
  mod.exports = exports;
  require.cache[absPath] = mod;
}
const libDir = path.resolve(__dirname, "..", "api", "_lib");
const apiDir = path.resolve(__dirname, "..", "api");
for (const rel of [
  "db.js", "stytch.js", "mcp-keys.js", "leads-store.js", "leads-companies-store.js",
  "outreach-schedule-store.js", "self-thread-store.js",
]) {
  delete require.cache[path.join(libDir, rel)];
}
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
    method: "POST",
    url: "/api/mcp",
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

test("set_company_priority creates and orders companies", async () => {
  const first = await mcpCall("set_company_priority", {
    companyName: "Stripe",
    priority: 1,
    northStar: true,
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.result.isError, undefined);
  assert.equal(first.body.result.structuredContent.company.name, "Stripe");
  assert.equal(first.body.result.structuredContent.company.priority, 1);
  assert.equal(first.body.result.structuredContent.company.northStar, true);

  const second = await mcpCall("set_company_priority", {
    companyName: "Notion",
    priority: 2,
  });
  assert.equal(second.body.result.structuredContent.company.priority, 2);
  const listed = await companies.listCompanies({ userId: "user-a", emailHint: "hunter@example.com" });
  assert.equal(listed[0].name, "Stripe");
  assert.equal(listed[1].name, "Notion");
});

test("plan_lead_touch sets role, next step, and due", async () => {
  const planned = await mcpCall("plan_lead_touch", {
    personName: "Morgan Kim",
    companyName: "Stripe",
    contactType: "referrer",
    touchType: "referral_outreach",
    dueDate: "2026-09-30T15:00:00.000Z",
    companyPriority: 1,
    northStar: true,
    queueOrder: 0,
    nextStep: "Referral intro",
  });
  assert.equal(planned.status, 200);
  assert.equal(planned.body.result.isError, undefined);
  const shaped = planned.body.result.structuredContent;
  assert.equal(shaped.lead.personName, "Morgan Kim");
  assert.equal(shaped.lead.contactType, "referrer");
  assert.equal(shaped.lead.company, "Stripe");
  assert.equal(shaped.touch.touchType, "referral_outreach");
  assert.match(String(shaped.touch.date), /2026-09-30/);

  const again = await mcpCall("plan_lead_touch", {
    personName: "Morgan Kim",
    companyName: "Stripe",
    contactType: "referrer",
    touchType: "referral_follow_up",
    dueDate: "2026-10-07T15:00:00.000Z",
  });
  assert.equal(again.body.result.structuredContent.touch.touchType, "referral_follow_up");
  assert.equal(tables.outreachTouch.rows.length, 1);
});

test("shell lists people and brands Lindow Labs", () => {
  const shell = fs.readFileSync(path.join(__dirname, "..", "src/renderer/messages-shell.js"), "utf8");
  assert.match(shell, /selectLead/);
  assert.match(shell, /THIS WEEK/);
  assert.match(shell, /LATER/);
  assert.match(shell, /Lindow Labs/);
  assert.match(shell, /lindow-labs\.svg/);
  assert.match(shell, /TOUCH_LABEL|referral_outreach/);
  assert.equal(/renderPersonTabs/.test(shell), false);
  // Ban em dashes in product copy; ignore // and /* */ comments so a
  // comment-only em dash does not fail CI (same rule as inbox-polish).
  const shellCopy = shell.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.equal(/—/.test(shellCopy), false);
  assert.ok(fs.existsSync(path.join(__dirname, "..", "src/renderer/icons/lindow-labs.svg")));
  const profile = fs.readFileSync(path.join(__dirname, "..", "src/renderer/profile.js"), "utf8");
  assert.match(profile, /never shown|Top-right profile avatar removed/i);
  assert.match(profile, /setAttribute\("hidden"/);
});
