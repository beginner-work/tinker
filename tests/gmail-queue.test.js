/* TYL-66: Gmail queue-to-send. Owner button only; sending off by default. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-gmail-queue";
process.env.STYTCH_SECRET = "secret-test-not-real";
process.env.LEADS_OWNER_ALLOWLIST = "user-a,hunter@example.com,user-b,other@example.com";

let seq = 0;
const tables = {};
function model() {
  const rows = [];
  return {
    rows,
    async create({ data }) {
      const now = new Date(Date.UTC(2026, 8, 29, 12, 0, ++seq));
      const row = Object.assign({
        id: "row_" + seq, createdAt: now, updatedAt: now,
        queuedTo: "", queuedSubject: "", queuedBody: "", queuedAt: null,
        gmailMessageId: "", gmailThreadId: "", sendFailedReason: "",
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
for (const name of ["lead", "leadDraft", "leadEvent", "tinkerUserData", "targetCompany"]) tables[name] = model();
const database = {
  $executeRawUnsafe: async () => 0,
  $transaction: async (fn) => fn(database),
  lead: tables.lead,
  leadDraft: tables.leadDraft,
  leadEvent: tables.leadEvent,
  tinkerUserData: tables.tinkerUserData,
  targetCompany: tables.targetCompany,
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
delete require.cache[require.resolve("../api/_lib/leads-store.js")];
delete require.cache[require.resolve("../api/leads.js")];
const store = require("../api/_lib/leads-store.js");
const handler = require("../api/leads.js");

async function call({ method, token = "user-a", action, body, query }) {
  const captured = { status: null, body: null };
  await handler({
    method, url: "/api/leads", headers: { authorization: token ? "Bearer " + token : "" }, body,
    query: Object.assign({ action }, query || {}),
  }, {
    setHeader() {},
    status(code) { captured.status = code; return this; },
    json(payload) { captured.body = payload; return this; },
  });
  return captured;
}

test.beforeEach(() => {
  seq = 0;
  for (const table of Object.values(tables)) table.rows.length = 0;
  store.resetTableCache();
});

test("sendingEnabled defaults off and queue is rejected until enabled", async () => {
  const settings = await call({ method: "GET", action: "settings" });
  assert.equal(settings.status, 200);
  assert.equal(settings.body.settings.sendingEnabled, false);

  const lead = await call({
    method: "POST", action: "create",
    body: { personName: "Sam Lee", company: "Orbit", source: "linkedin", email: "sam@orbit.test" },
  });
  const draft = await call({
    method: "POST", action: "draft",
    body: { leadId: lead.body.lead.id, channel: "gmail_outreach", subject: "Hi", body: "Hello Sam" },
  });
  const blocked = await call({ method: "POST", action: "queue-send", body: { id: draft.body.draft.id } });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /Sending is off/i);
});

test("queue freezes to subject body; edit un-queues; cross-owner 404", async () => {
  await call({ method: "POST", action: "settings", body: { sendingEnabled: true } });
  const lead = await call({
    method: "POST", action: "create",
    body: { personName: "Sam Lee", company: "Orbit", source: "linkedin", email: "sam@orbit.test" },
  });
  const draft = await call({
    method: "POST", action: "draft",
    body: { leadId: lead.body.lead.id, channel: "gmail_outreach", subject: "Hi", body: "Hello Sam" },
  });
  const draftId = draft.body.draft.id;

  const queued = await call({ method: "POST", action: "queue-send", body: { id: draftId } });
  assert.equal(queued.status, 200);
  assert.equal(queued.body.draft.status, "queued_to_send");
  assert.equal(queued.body.draft.queuedTo, "sam@orbit.test");
  assert.equal(queued.body.draft.queuedSubject, "Hi");
  assert.equal(queued.body.draft.queuedBody, "Hello Sam");
  assert.ok(queued.body.draft.queuedAt);

  const other = await call({ method: "POST", token: "user-b", action: "queue-send", body: { id: draftId } });
  assert.equal(other.status, 404);

  const edited = await call({ method: "PATCH", action: "draft", body: { id: draftId, body: "Revised" } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.draft.status, "draft");
  assert.equal(edited.body.draft.body, "Revised");
  assert.equal(edited.body.draft.queuedTo, "");
  assert.equal(edited.body.draft.queuedBody, "");
});

test("mcp bearer cannot hit leads queue-send; LinkedIn cannot queue", async () => {
  const mcp = await call({
    method: "POST", token: "mcp_fake", action: "queue-send", body: { id: "x" },
  });
  assert.equal(mcp.status, 401);

  await call({ method: "POST", action: "settings", body: { sendingEnabled: true } });
  const lead = await call({
    method: "POST", action: "create",
    body: { personName: "Sam", company: "Orbit", source: "linkedin", email: "sam@orbit.test" },
  });
  const li = await call({
    method: "POST", action: "draft",
    body: { leadId: lead.body.lead.id, channel: "linkedin_connection", body: "Note" },
  });
  const bad = await call({ method: "POST", action: "queue-send", body: { id: li.body.draft.id } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Gmail/i);
});

test("no Google OAuth or Gmail API client in this slice", () => {
  const root = path.join(__dirname, "..");
  assert.equal(fs.existsSync(path.join(root, "api/gmail.js")), false);
  assert.equal(fs.existsSync(path.join(root, "api/_lib/gmail-transport.js")), false);
  const storeSrc = fs.readFileSync(path.join(root, "api/_lib/leads-store.js"), "utf8");
  assert.match(storeSrc, /queueDraftForSend/);
  assert.match(storeSrc, /sendingEnabled/);
  assert.equal(/googleapis|GOOGLE_OAUTH|GMAIL_TOKEN/.test(storeSrc), false);
});
