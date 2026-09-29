/* Approve-to-send handoff: This is everything → approved_to_send; edit revokes; MCP list/mark. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-approved-outreach";
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
  "outreach-schedule-store.js", "self-thread-store.js", "calendar-date.js",
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
const leads = require("../api/_lib/leads-store.js");
const companies = require("../api/_lib/leads-companies-store.js");
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
});

test("approve stores exact text; edit revokes; list and mark sent", async () => {
  await leads.setOutreachSettings({
    userId: "user-a", emailHint: "hunter@example.com", patch: { sendingEnabled: true },
  });
  await mcpCall("upsert_target_company", { name: "Stripe", tier: "north_star" });
  const person = await mcpCall("upsert_lead_person", {
    personName: "Morgan Kim",
    companyName: "Stripe",
    contactType: "referrer",
    email: "morgan@example.com",
    linkedInUrl: "https://www.linkedin.com/in/morgan",
  });
  const leadId = person.body.result.structuredContent.lead.id;
  const actor = { kind: "human", label: "user:user-a" };
  const created = await leads.createDraft({
    userId: "user-a",
    emailHint: "hunter@example.com",
    actor,
    leadId,
    channel: "gmail_outreach",
    subject: "Quick intro",
    body: "Morgan — exact approved words only.",
  });
  const draftId = created.draft.id;

  const approved = await leads.approveDraft({
    id: draftId, userId: "user-a", emailHint: "hunter@example.com", actor,
  });
  assert.equal(approved.draft.status, "approved_to_send");
  assert.equal(approved.draft.approvedText, "Morgan — exact approved words only.");
  assert.equal(approved.draft.approvedPersonName, "Morgan Kim");
  assert.equal(approved.draft.approvedCompanyName, "Stripe");
  assert.ok(approved.draft.approvedAt);

  const listed = await mcpCall("list_approved_outreach", {});
  assert.equal(listed.status, 200);
  assert.equal(listed.body.result.isError, undefined);
  const rows = listed.body.result.structuredContent.outreach;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, draftId);
  assert.equal(rows[0].approvedText, "Morgan — exact approved words only.");
  assert.equal(rows[0].personName, "Morgan Kim");
  assert.equal(rows[0].companyName, "Stripe");
  assert.equal(rows[0].email, "morgan@example.com");
  assert.equal(rows[0].linkedInUrl, "https://www.linkedin.com/in/morgan");
  assert.equal(rows[0].channel, "gmail_outreach");
  assert.equal(rows[0].subject, "Quick intro");

  // Edit after approve revokes handoff.
  const edited = await leads.updateDraft({
    id: draftId, userId: "user-a", emailHint: "hunter@example.com", actor,
    patch: { body: "Morgan — changed after approve." },
  });
  assert.equal(edited.status, "draft");
  assert.equal(edited.approvedText, "");
  assert.equal(edited.approvedAt, null);

  const emptyList = await mcpCall("list_approved_outreach", {});
  assert.equal(emptyList.body.result.structuredContent.outreach.length, 0);

  // Re-approve and mark sent.
  await leads.updateDraft({
    id: draftId, userId: "user-a", emailHint: "hunter@example.com", actor,
    patch: { body: "Morgan — final send text." },
  });
  await leads.approveDraft({ id: draftId, userId: "user-a", emailHint: "hunter@example.com", actor });
  const sent = await mcpCall("mark_outreach_sent", {
    id: draftId,
    channel: "gmail_outreach",
    sentAt: "2026-10-02T18:00:00.000Z",
    externalMessageId: "msg_abc",
  });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.result.isError, undefined);
  assert.equal(sent.body.result.structuredContent.draft.status, "sent_by_owner");
  assert.equal(sent.body.result.structuredContent.draft.externalMessageId, "msg_abc");

  // One approval covers one send — cannot mark again.
  const again = await mcpCall("mark_outreach_sent", { id: draftId });
  assert.equal(again.body.result.isError, true);

  const afterSent = await mcpCall("list_approved_outreach", {});
  assert.equal(afterSent.body.result.structuredContent.outreach.length, 0);
});

test("mark_outreach_failed keeps text and allows re-approve", async () => {
  await leads.setOutreachSettings({
    userId: "user-a", emailHint: "hunter@example.com", patch: { sendingEnabled: true },
  });
  await mcpCall("upsert_target_company", { name: "Notion" });
  const person = await mcpCall("upsert_lead_person", {
    personName: "Sam Patel", companyName: "Notion", contactType: "hiring_leader",
    email: "sam@notion.test",
  });
  const leadId = person.body.result.structuredContent.lead.id;
  const actor = { kind: "human", label: "user:user-a" };
  const created = await leads.createDraft({
    userId: "user-a", emailHint: "hunter@example.com", actor, leadId,
    channel: "gmail_outreach", subject: "Hi Sam", body: "Sam — outreach note.",
  });
  await leads.approveDraft({
    id: created.draft.id, userId: "user-a", emailHint: "hunter@example.com", actor,
  });
  const failed = await mcpCall("mark_outreach_failed", {
    id: created.draft.id, reason: "Gmail temporary error",
  });
  assert.equal(failed.body.result.structuredContent.draft.status, "send_failed");
  assert.equal(failed.body.result.structuredContent.draft.failedReason, "Gmail temporary error");
  assert.equal(failed.body.result.structuredContent.draft.approvedText, "Sam — outreach note.");

  // Owner can edit (revokes) then approve again.
  await leads.updateDraft({
    id: created.draft.id, userId: "user-a", emailHint: "hunter@example.com", actor,
    patch: { body: "Sam — retry note." },
  });
  const again = await leads.approveDraft({
    id: created.draft.id, userId: "user-a", emailHint: "hunter@example.com", actor,
  });
  assert.equal(again.draft.status, "approved_to_send");
  assert.equal(again.draft.approvedText, "Sam — retry note.");
});

test("LinkedIn approve is copy-only and omitted from list_approved_outreach", async () => {
  await leads.setOutreachSettings({
    userId: "user-a", emailHint: "hunter@example.com", patch: { sendingEnabled: true },
  });
  await mcpCall("upsert_target_company", { name: "Linear" });
  const person = await mcpCall("upsert_lead_person", {
    personName: "Alex Rivera", companyName: "Linear", contactType: "referrer",
  });
  const leadId = person.body.result.structuredContent.lead.id;
  const actor = { kind: "human", label: "user:user-a" };
  const created = await leads.createDraft({
    userId: "user-a", emailHint: "hunter@example.com", actor, leadId,
    channel: "linkedin_connection", body: "Alex — connection note.",
  });
  const approved = await leads.approveDraft({
    id: created.draft.id, userId: "user-a", emailHint: "hunter@example.com", actor,
  });
  assert.equal(approved.draft.status, "approved");
  const listed = await mcpCall("list_approved_outreach", {});
  assert.equal(listed.body.result.structuredContent.outreach.length, 0);
});

test("tools/list exposes approved outreach tools", async () => {
  const res = fakeRes();
  await mcp({
    method: "POST", url: "/api/mcp",
    headers: { authorization: "Bearer " + "mcp_" + "a".repeat(43) },
    body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  }, res);
  const names = res.captured.body.result.tools.map((t) => t.name);
  assert.ok(names.includes("list_approved_outreach"));
  assert.ok(names.includes("mark_outreach_sent"));
  assert.ok(names.includes("mark_outreach_failed"));
});
