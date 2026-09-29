/* TYL-66: MCP send-queue tools. No tool queues/approves; cross-owner isolated. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-gmail-mcp";
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
      const row = Object.assign({
        id: "row_" + seq, createdAt: now, updatedAt: now,
        queuedTo: "", queuedSubject: "", queuedBody: "", queuedAt: null,
        gmailMessageId: "", gmailThreadId: "", sendFailedReason: "",
        fromAddress: "",
      }, data);
      if (!row.id || row.id.startsWith("row_")) {
        /* keep provided id from replies store */
      }
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
for (const name of ["lead", "leadDraft", "leadEvent", "tinkerUserData", "targetCompany", "leadReply"]) {
  tables[name] = model();
}
const database = {
  $executeRawUnsafe: async () => 0,
  $transaction: async (fn) => fn(database),
  lead: tables.lead,
  leadDraft: tables.leadDraft,
  leadEvent: tables.leadEvent,
  tinkerUserData: tables.tinkerUserData,
  targetCompany: tables.targetCompany,
  leadReply: tables.leadReply,
};
function stubAt(absPath, exports) {
  const mod = new Module(absPath);
  mod.filename = absPath; mod.loaded = true; mod.exports = exports;
  require.cache[absPath] = mod;
}
const libDir = path.resolve(__dirname, "..", "api", "_lib");
stubAt(path.join(libDir, "db.js"), database);
delete require.cache[require.resolve("../api/_lib/leads-store.js")];
delete require.cache[require.resolve("../api/_lib/lead-replies-store.js")];
delete require.cache[require.resolve("../api/_lib/gmail-queue-mcp.js")];
const store = require("../api/_lib/leads-store.js");
const replies = require("../api/_lib/lead-replies-store.js");
const gmailMcp = require("../api/_lib/gmail-queue-mcp.js");

async function seedQueued(owner) {
  const lead = await store.createLead({
    userId: owner, emailHint: owner === "user-a" ? "hunter@example.com" : "other@example.com",
    actor: { kind: "human", label: "user:" + owner },
    personName: "Sam Lee", company: "Orbit", source: "linkedin", email: "sam@orbit.test",
  });
  const draft = await store.createDraft({
    userId: owner, emailHint: owner === "user-a" ? "hunter@example.com" : "other@example.com",
    actor: { kind: "human", label: "user:" + owner },
    leadId: lead.id, channel: "gmail_outreach", subject: "Hi", body: "Hello Sam",
  });
  await store.setOutreachSettings({
    userId: owner, emailHint: owner === "user-a" ? "hunter@example.com" : "other@example.com",
    patch: { sendingEnabled: true },
  });
  const queued = await store.queueDraftForSend({
    userId: owner, emailHint: owner === "user-a" ? "hunter@example.com" : "other@example.com",
    actor: { kind: "human", label: "user:" + owner },
    id: draft.draft.id,
  });
  return { lead, draft: queued.draft };
}

function toolResult(outcome) {
  return outcome.body.result;
}

test.beforeEach(() => {
  seq = 0;
  for (const table of Object.values(tables)) table.rows.length = 0;
  store.resetTableCache();
  replies.resetTableCache();
});

test("tools list schemas and no queue/approve tool", () => {
  const names = gmailMcp.TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, ["add_reply", "list_send_queue", "mark_send_failed", "mark_sent"]);
  for (const tool of gmailMcp.TOOLS) {
    assert.equal(tool.inputSchema.type, "object");
    assert.match(tool.description, /cannot queue/i);
  }
  const mcpSrc = fs.readFileSync(path.join(__dirname, "..", "api/mcp.js"), "utf8");
  assert.match(mcpSrc, /gmail-queue-mcp|list_send_queue/);
  assert.equal(/queue-send|queueDraftForSend/.test(mcpSrc), false);
});

test("list_send_queue is owner-scoped; mark_sent and failed work", async () => {
  const a = await seedQueued("user-a");
  await seedQueued("user-b");

  const listed = await gmailMcp.callTool({ id: 1 }, { userId: "user-a" }, "list_send_queue", {});
  const queue = toolResult(listed).structuredContent.queue;
  assert.equal(queue.length, 1);
  assert.equal(queue[0].messageId, a.draft.id);
  assert.equal(queue[0].to, "sam@orbit.test");
  assert.equal(queue[0].subject, "Hi");
  assert.equal(queue[0].body, "Hello Sam");
  assert.equal(queue[0].lead.personName, "Sam Lee");

  const other = await gmailMcp.callTool(
    { id: 2 }, { userId: "user-b" }, "mark_sent",
    { messageId: a.draft.id, gmailMessageId: "g1", gmailThreadId: "t1" },
  );
  assert.equal(toolResult(other).isError, true);

  const sent = await gmailMcp.callTool(
    { id: 3 }, { userId: "user-a" }, "mark_sent",
    { messageId: a.draft.id, gmailMessageId: "msg-a", gmailThreadId: "thr-a", sentAt: "2026-09-29T15:00:00.000Z" },
  );
  assert.equal(toolResult(sent).structuredContent.draft.status, "sent_by_owner");
  assert.equal(toolResult(sent).structuredContent.draft.gmailMessageId, "msg-a");
  assert.equal(toolResult(sent).structuredContent.draft.gmailThreadId, "thr-a");

  const b = await seedQueued("user-a");
  const failed = await gmailMcp.callTool(
    { id: 4 }, { userId: "user-a" }, "mark_send_failed",
    { messageId: b.draft.id, reason: "Mailbox full" },
  );
  assert.equal(toolResult(failed).structuredContent.draft.status, "send_failed");
  assert.equal(toolResult(failed).structuredContent.draft.sendFailedReason, "Mailbox full");
});

test("add_reply dedupes on gmailMessageId and stays owner-scoped", async () => {
  const a = await seedQueued("user-a");
  await gmailMcp.callTool(
    { id: 1 }, { userId: "user-a" }, "mark_sent",
    { messageId: a.draft.id, gmailMessageId: "out-1", gmailThreadId: "thr-shared" },
  );

  const first = await gmailMcp.callTool(
    { id: 2 }, { userId: "user-a" }, "add_reply",
    {
      leadId: a.lead.id, from: "sam@orbit.test", body: "Thanks!",
      receivedAt: "2026-09-29T16:00:00.000Z", gmailMessageId: "in-1",
    },
  );
  assert.equal(toolResult(first).structuredContent.deduped, false);
  assert.equal(toolResult(first).structuredContent.reply.body, "Thanks!");

  const again = await gmailMcp.callTool(
    { id: 3 }, { userId: "user-a" }, "add_reply",
    {
      gmailThreadId: "thr-shared", from: "sam@orbit.test", body: "Thanks again!",
      receivedAt: "2026-09-29T16:05:00.000Z", gmailMessageId: "in-1",
    },
  );
  assert.equal(toolResult(again).structuredContent.deduped, true);
  assert.equal(toolResult(again).structuredContent.reply.body, "Thanks!");

  const cross = await gmailMcp.callTool(
    { id: 4 }, { userId: "user-b" }, "add_reply",
    {
      leadId: a.lead.id, from: "sam@orbit.test", body: "Nope",
      gmailMessageId: "in-2",
    },
  );
  assert.equal(toolResult(cross).isError, true);

  const listed = await replies.listForLead({ userId: "user-a", leadId: a.lead.id });
  assert.equal(listed.length, 1);
});

test("MCP cannot invent a queue-send tool name", async () => {
  const outcome = await gmailMcp.callTool({ id: 9 }, { userId: "user-a" }, "queue_send", {});
  assert.equal(toolResult(outcome).isError, true);
  assert.match(toolResult(outcome).content[0].text, /Unknown tool/);
});

test("assistant reply sync path and send-only manual path both exist", () => {
  const root = path.join(__dirname, "..");
  const thread = fs.readFileSync(path.join(root, "src/renderer/messages-thread.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
  /* Automatic path: assistant calls add_reply (no Tinker Gmail OAuth / reply-sync flag). */
  assert.ok(gmailMcp.TOOL_NAMES.has("add_reply"));
  assert.equal(fs.existsSync(path.join(root, "api/gmail.js")), false);
  assert.equal(/GMAIL_REPLY_SYNC_ENABLED|GOOGLE_OAUTH_CLIENT/.test(thread), false);
  /* Manual send-only path: outcome buttons log a left bubble without restricted read scope. */
  assert.match(html, /data-outcome="replied"/);
  assert.match(thread, /appendManualReplyNote/);
});
