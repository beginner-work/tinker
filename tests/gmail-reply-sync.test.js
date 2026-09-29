/* LL-66 slice 2: gmailThreadId on mark_sent + add_reply MCP (dedupe). */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-gmail-reply-sync";
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
      const now = new Date(Date.UTC(2026, 8, 29, 22, 30, ++seq));
      const row = Object.assign({
        id: "row_" + seq, createdAt: now, updatedAt: now,
        gmailThreadId: "", externalMessageId: "", failedReason: "",
        approvedText: "", approvedPersonName: "", approvedCompanyName: "",
        approvedAt: null, sentAt: null,
      }, data);
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
  "lead", "leadDraft", "leadEvent", "leadReply", "tinkerUserData", "targetCompany",
  "outreachTouch", "outreachSession",
]) tables[name] = model();
const database = {
  $executeRawUnsafe: async () => 0,
  $transaction: async (fn) => fn(database),
  lead: tables.lead,
  leadDraft: tables.leadDraft,
  leadEvent: tables.leadEvent,
  leadReply: tables.leadReply,
  tinkerUserData: tables.tinkerUserData,
  targetCompany: tables.targetCompany,
  outreachTouch: tables.outreachTouch,
  outreachSession: tables.outreachSession,
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
  "lead-replies-store.js", "outreach-schedule-store.js", "self-thread-store.js", "calendar-date.js",
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
    if (token === "mcp_" + "b".repeat(43)) return { id: "k2", label: "other", userId: "user-b" };
    throw Object.assign(new Error("Invalid API key."), { status: 401 });
  },
  userIdFromSession: (s) => (s && s.session && s.session.user_id) || "",
});
const mcp = require("../api/mcp.js");
const leads = require("../api/_lib/leads-store.js");
const companies = require("../api/_lib/leads-companies-store.js");
const replies = require("../api/_lib/lead-replies-store.js");

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
async function mcpCall(name, args, token) {
  const res = fakeRes();
  const bearer = token || ("mcp_" + "a".repeat(43));
  await mcp({
    method: "POST", url: "/api/mcp",
    headers: { authorization: "Bearer " + bearer },
    body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } },
  }, res);
  return res.captured;
}

test.beforeEach(() => {
  seq = 0;
  for (const table of Object.values(tables)) table.rows.length = 0;
  companies.resetTableCache();
  leads.resetTableCache();
  replies.resetTableCache();
});

async function seedApprovedGmail() {
  await leads.setOutreachSettings({
    userId: "user-a", emailHint: "hunter@example.com", patch: { sendingEnabled: true },
  });
  await mcpCall("upsert_target_company", { name: "Stripe", tier: "north_star" });
  const person = await mcpCall("upsert_lead_person", {
    personName: "Morgan Kim", companyName: "Stripe", contactType: "referrer",
    email: "morgan@example.com",
  });
  const leadId = person.body.result.structuredContent.lead.id;
  const actor = { kind: "human", label: "user:user-a" };
  const created = await leads.createDraft({
    userId: "user-a", emailHint: "hunter@example.com", actor, leadId,
    channel: "gmail_outreach", subject: "Hi", body: "Hello Morgan",
  });
  await leads.approveDraft({
    id: created.draft.id, userId: "user-a", emailHint: "hunter@example.com", actor,
  });
  return { leadId, draftId: created.draft.id };
}

test("mark_outreach_sent stores gmailThreadId", async () => {
  const { draftId } = await seedApprovedGmail();
  const sent = await mcpCall("mark_outreach_sent", {
    id: draftId,
    externalMessageId: "msg_1",
    gmailThreadId: "thread_abc",
  });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.result.isError, undefined);
  assert.equal(sent.body.result.structuredContent.draft.status, "sent_by_owner");
  assert.equal(sent.body.result.structuredContent.draft.gmailThreadId, "thread_abc");
  assert.equal(sent.body.result.structuredContent.draft.externalMessageId, "msg_1");
});

test("add_reply by leadId and by gmailThreadId; dedupe on gmailMessageId", async () => {
  const { leadId, draftId } = await seedApprovedGmail();
  await mcpCall("mark_outreach_sent", {
    id: draftId, externalMessageId: "msg_1", gmailThreadId: "thread_abc",
  });

  const first = await mcpCall("add_reply", {
    leadId,
    from: "morgan@example.com",
    body: "Thanks — let's talk.",
    receivedAt: "2026-10-01T15:00:00.000Z",
    gmailMessageId: "reply_msg_1",
  });
  assert.equal(first.body.result.isError, undefined);
  assert.equal(first.body.result.structuredContent.deduped, false);
  assert.equal(first.body.result.structuredContent.reply.body, "Thanks — let's talk.");
  assert.equal(first.body.result.structuredContent.reply.side, "lead");

  const again = await mcpCall("add_reply", {
    leadId,
    body: "Thanks — let's talk.",
    gmailMessageId: "reply_msg_1",
  });
  assert.equal(again.body.result.structuredContent.deduped, true);

  const byThread = await mcpCall("add_reply", {
    gmailThreadId: "thread_abc",
    from: "morgan@example.com",
    body: "Second note.",
    gmailMessageId: "reply_msg_2",
  });
  assert.equal(byThread.body.result.structuredContent.deduped, false);
  assert.equal(byThread.body.result.structuredContent.reply.leadId, leadId);

  const listed = await replies.listForLead({ userId: "user-a", leadId });
  assert.equal(listed.length, 2);

  const lead = await leads.getLead({ id: leadId, userId: "user-a", emailHint: "hunter@example.com" });
  assert.equal(lead.lead.stage, "replied");
});

test("cross-owner add_reply cannot see another owner's lead or thread", async () => {
  const { leadId, draftId } = await seedApprovedGmail();
  await mcpCall("mark_outreach_sent", {
    id: draftId, gmailThreadId: "thread_secret",
  });
  const other = await mcpCall("add_reply", {
    leadId,
    body: "Nope",
    gmailMessageId: "evil_1",
  }, "mcp_" + "b".repeat(43));
  assert.equal(other.body.result.isError, true);

  const otherThread = await mcpCall("add_reply", {
    gmailThreadId: "thread_secret",
    body: "Nope",
    gmailMessageId: "evil_2",
  }, "mcp_" + "b".repeat(43));
  assert.equal(otherThread.body.result.isError, true);
});

test("tools/list exposes add_reply", async () => {
  const res = fakeRes();
  await mcp({
    method: "POST", url: "/api/mcp",
    headers: { authorization: "Bearer " + "mcp_" + "a".repeat(43) },
    body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  }, res);
  const names = res.captured.body.result.tools.map((t) => t.name);
  assert.ok(names.includes("add_reply"));
  assert.ok(names.includes("list_approved_outreach"));
  assert.ok(names.includes("mark_outreach_sent"));
});
