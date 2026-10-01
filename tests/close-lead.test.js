/* close_lead / reopen_lead: inbox exclusion, touch skipping, schedule ignore. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("node:module");
const fs = require("node:fs");

process.env.STYTCH_PROJECT_ID = "project-test-close-lead";
process.env.STYTCH_SECRET = "secret-test-not-real";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
process.env.LEADS_OWNER_ALLOWLIST = "";

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
  "lead", "leadDraft", "leadEvent", "tinkerUserData", "targetCompany",
  "outreachTouch", "outreachSession", "jobApplication", "readingThread",
]) tables[name] = model();
const database = {
  $executeRawUnsafe: async () => 0,
  $transaction: async (fn) => fn(database),
  lead: tables.lead, leadDraft: tables.leadDraft, leadEvent: tables.leadEvent,
  tinkerUserData: tables.tinkerUserData, targetCompany: tables.targetCompany,
  outreachTouch: tables.outreachTouch, outreachSession: tables.outreachSession,
  jobApplication: tables.jobApplication, readingThread: tables.readingThread,
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
  "outreach-schedule-store.js", "self-thread-store.js", "inbox-rank.js",
  "job-application-store.js", "reading-thread-store.js",
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
const MCP_KEY = "mcp_" + "a".repeat(43);
async function mcpCall(name, args) {
  const res = fakeRes();
  await mcp({
    method: "POST",
    url: "/api/mcp",
    headers: { authorization: "Bearer " + MCP_KEY, "content-type": "application/json" },
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args || {} },
    },
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

test("close_lead sets stage closed, stores reason, skips open touches", async () => {
  const person = await mcpCall("upsert_lead_person", {
    personName: "Alex Rivera",
    companyName: "Orbit",
    contactType: "hiring_leader",
    nextStep: "Follow up after the call",
    dueDate: "2026-10-02",
    touchType: "call_follow_up",
    notes: "### What mattered?\n\nThey liked the reliability story\n",
  });
  assert.equal(person.status, 200);
  assert.equal(person.body.result.isError, undefined);
  const leadId = person.body.result.structuredContent.lead.id;
  const touchId = person.body.result.structuredContent.touch.id;
  assert.equal(person.body.result.structuredContent.lead.stage, "new");
  assert.equal(person.body.result.structuredContent.touch.status, "planned");

  const closed = await mcpCall("close_lead", {
    personId: leadId,
    reason: "Squared away after the call",
  });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.result.isError, undefined);
  const body = closed.body.result.structuredContent;
  assert.equal(body.lead.stage, "closed");
  assert.equal(body.lead.previousStage, "new");
  assert.equal(body.lead.closedReason, "Squared away after the call");
  assert.ok(body.lead.closedAt);
  assert.match(body.lead.notes, /reliability story/);
  assert.equal(body.skippedTouches.length, 1);
  assert.equal(body.skippedTouches[0].id, touchId);
  assert.equal(body.skippedTouches[0].status, "skipped");

  const touchRow = tables.outreachTouch.rows.find((row) => row.id === touchId);
  assert.equal(touchRow.status, "skipped");
});

test("closed lead leaves list_inbox but stays in list_target_companies", async () => {
  const created = await mcpCall("upsert_lead_person", {
    personName: "Jamie Chen",
    companyName: "Northwind",
    contactType: "referrer",
    dueDate: "2026-10-03",
    touchType: "referral_outreach",
  });
  const leadId = created.body.result.structuredContent.lead.id;
  await mcpCall("close_lead", { personName: "Jamie Chen", companyName: "Northwind" });

  const inbox = await mcpCall("list_inbox", { limit: 50 });
  assert.equal(inbox.status, 200);
  const items = inbox.body.result.structuredContent.items || [];
  assert.equal(items.some((row) => row.id === leadId), false);

  const companiesList = await mcpCall("list_target_companies", {});
  assert.equal(companiesList.status, 200);
  const row = (companiesList.body.result.structuredContent.companies || [])
    .find((item) => item.company && item.company.name === "Northwind");
  assert.ok(row);
  const person = (row.people || []).find((p) => p.id === leadId)
    || (row.people || []).find((p) => p.personName === "Jamie Chen");
  assert.ok(person, "closed lead still listed under the company");
  assert.equal(person.stage, "closed");
});

test("reopen_lead restores previousStage", async () => {
  const created = await mcpCall("upsert_lead_person", {
    personName: "Pat Lee",
    companyName: "Alloy",
    contactType: "hiring_leader",
  });
  const leadId = created.body.result.structuredContent.lead.id;
  await leads.setStage({
    id: leadId,
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor: { kind: "bot", label: "bot:mcp" },
    stage: "contacted",
  });
  const closed = await mcpCall("close_lead", { personId: leadId, reason: "Pause" });
  assert.equal(closed.body.result.structuredContent.lead.previousStage, "contacted");

  const reopened = await mcpCall("reopen_lead", { personId: leadId });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.result.isError, undefined);
  assert.equal(reopened.body.result.structuredContent.lead.stage, "contacted");
  assert.equal(reopened.body.result.structuredContent.previousStage, "contacted");
  assert.match(reopened.body.result.structuredContent.lead.notes == null
    ? ""
    : String(reopened.body.result.structuredContent.lead.notes), /^/);
});

test("get_outreach_schedule ignores closed leads for missing-touch and follow-ups", async () => {
  const person = await mcpCall("upsert_lead_person", {
    personName: "Sam Ortiz",
    companyName: "SoloCo",
    contactType: "hiring_leader",
    dueDate: "2026-09-30",
    touchType: "call_follow_up",
  });
  const companyId = person.body.result.structuredContent.company.id;
  const leadId = person.body.result.structuredContent.lead.id;

  const before = await mcpCall("get_outreach_schedule", { weekStart: "2026-09-29" });
  assert.equal(before.status, 200);
  const beforeMissing = before.body.result.structuredContent.companiesMissingTouch || [];
  assert.equal(beforeMissing.some((row) => row.id === companyId), false);

  await mcpCall("close_lead", { personId: leadId });

  const after = await mcpCall("get_outreach_schedule", { weekStart: "2026-09-29" });
  assert.equal(after.status, 200);
  const week = after.body.result.structuredContent;
  const missing = week.companiesMissingTouch || [];
  assert.equal(missing.some((row) => row.id === companyId), false,
    "company with only closed leads is not missing a touch");
  const allTouches = [
    ...(week.unscheduledTouches || []),
    ...((week.sessions || []).flatMap((s) => s.touches || [])),
  ];
  assert.equal(allTouches.some((row) => row.touch && row.touch.leadId === leadId), false);
});

test("shell filters closed leads from the inbox rail", () => {
  const shell = fs.readFileSync(path.join(__dirname, "..", "src/renderer/messages-shell.js"), "utf8");
  assert.match(shell, /stage.*closed/);
  assert.match(shell, /visibleLeads/);
});
