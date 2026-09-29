/* TYL-54 messaging. Postgres is stubbed. No send path. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-messaging";
process.env.STYTCH_SECRET = "secret-test-not-real";

let seq = 0;
const tables = {};

function model() {
  const rows = [];
  return {
    rows,
    async create({ data }) {
      const clash = (field) => data[field] && rows.some((row) => row.userId === data.userId && row[field] === data[field]);
      if (clash("email") || clash("draftKey")) throw Object.assign(new Error("unique"), { code: "P2002" });
      const now = new Date(Date.UTC(2026, 8, 29, 0, 0, ++seq));
      const row = Object.assign({ id: "row_" + seq, createdAt: now, updatedAt: now }, data);
      rows.push(row);
      return row;
    },
    async findUnique({ where }) {
      if (where.id) return rows.find((row) => row.id === where.id) || null;
      const pair = where.userId_email || where.userId_draftKey;
      if (!pair) return null;
      const field = where.userId_email ? "email" : "draftKey";
      return rows.find((row) => row.userId === pair.userId && row[field] === pair[field]) || null;
    },
    async findMany({ where = {} } = {}) {
      return rows.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
    },
    async update({ where, data }) {
      const row = rows.find((item) => item.id === where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
  };
}

for (const name of ["messagingContact", "messagingThread", "messagingMessage", "messagingEvent"]) tables[name] = model();

const database = {
  $executeRawUnsafe: async () => 0,
  $transaction: async (fn) => fn(database),
  messagingContact: tables.messagingContact,
  messagingThread: tables.messagingThread,
  messagingMessage: tables.messagingMessage,
  messagingEvent: tables.messagingEvent,
};

function stubAt(absPath, exports) {
  const mod = new Module(absPath);
  mod.filename = absPath;
  mod.loaded = true;
  mod.exports = exports;
  require.cache[absPath] = mod;
}

const libDir = path.resolve(__dirname, "..", "api", "_lib");
stubAt(path.join(libDir, "stytch.js"), {
  authenticateSession: async (token) => {
    if (token !== "user-a" && token !== "user-b") throw Object.assign(new Error("nope"), { status: 401 });
    const email = token === "user-a" ? "tyler@example.com" : "other@example.com";
    return { session: { user_id: token }, user: { user_id: token, emails: [{ email }] } };
  },
});
stubAt(path.join(libDir, "db.js"), database);

const store = require("../api/_lib/messaging-store.js");
const handler = require("../api/messaging.js");
const human = { kind: "human", label: "tyler:tyler@example.com" };

async function call({ method, token = "user-a", action, body, id }) {
  const captured = { status: null, body: null };
  await handler({
    method,
    url: "/api/messaging",
    headers: { authorization: token ? "Bearer " + token : "" },
    body,
    query: { action, id },
  }, {
    setHeader() {},
    status(code) { captured.status = code; return this; },
    json(payload) { captured.body = payload; return this; },
  });
  return captured;
}

async function setup(extra) {
  const contact = await call({
    method: "POST",
    action: "contact",
    body: Object.assign({ email: "ada@example.com", name: "Ada", company: "Example Co", title: "Founder", source: "manual", tags: ["gtm"], notes: "Met at a demo." }, extra),
  });
  const thread = await call({
    method: "POST",
    action: "thread",
    body: { contactId: contact.body.contact.id, channel: "email", subject: "Hello" },
  });
  const draft = await call({
    method: "POST",
    action: "draft",
    body: { threadId: thread.body.thread.id, body: "Hi", fromAddr: "tyler@example.com", toAddr: "ada@example.com", draftKey: "k1" },
  });
  return { contact, threadId: thread.body.thread.id, contactId: contact.body.contact.id, id: draft.body.message.id };
}

test.beforeEach(() => {
  seq = 0;
  for (const table of Object.values(tables)) table.rows.length = 0;
  store.resetTableCache();
});

test("migration matches and this slice does not send", () => {
  const root = path.join(__dirname, "..");
  const migration = fs.readFileSync(path.join(root, "prisma/migrations/20260929020000_add_messaging/migration.sql"), "utf8");
  for (const statement of store.TABLE_STATEMENTS) assert.ok(migration.includes(statement), statement.slice(0, 40));
  const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  for (const name of ["MessagingContact", "MessagingThread", "MessagingMessage", "MessagingEvent"]) {
    assert.ok(schema.includes("model " + name));
  }
  const source = fs.readFileSync(path.join(libDir, "messaging-store.js"), "utf8")
    + fs.readFileSync(path.join(root, "api/messaging.js"), "utf8") + migration;
  for (const word of ["sendgrid", "resend", "nodemailer", "mailgun", "postmark", "smtp", "sk_live"]) {
    assert.equal(source.toLowerCase().includes(word), false, word);
  }
  assert.equal(source.includes("MESSAGING_SEND_ENABLED"), true);
  assert.equal(/status:\s*["']sent["']/.test(source), false);
  const emails = fs.readFileSync(__filename, "utf8").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  assert.ok(emails.length > 0 && emails.every((email) => email.endsWith("@example.com")));
});

test("owner can create, move, and audit; another user gets 404", async () => {
  const made = await setup();
  assert.equal(made.contact.status, 201);
  assert.equal(made.contact.body.contact.email, "ada@example.com");
  const again = await call({ method: "POST", action: "contact", body: { email: "Ada@example.com", source: "manual" } });
  assert.equal(again.body.created, false);
  assert.equal(again.body.contact.id, made.contactId);
  const same = await call({ method: "POST", action: "draft", body: { threadId: made.threadId, draftKey: "k1", body: "ignored" } });
  assert.equal(same.body.created, false);
  assert.equal(same.body.message.id, made.id);
  assert.equal((await call({ method: "GET", action: "contacts" })).body.contacts.length, 1);
  assert.equal((await call({ method: "GET", action: "threads" })).body.threads.length, 1);
  assert.equal((await call({ method: "GET", action: "contact", id: made.contactId })).body.contact.name, "Ada");
  const edited = await call({ method: "PATCH", action: "draft", id: made.id, body: { body: "Edited." } });
  assert.equal(edited.body.message.body, "Edited.");

  await assert.rejects(() => store.transition({ id: made.id, userId: "user-a", to: "sent", actor: human }), (err) => err.status === 400);
  assert.equal((await call({ method: "POST", action: "sent", id: made.id })).status, 400);
  assert.equal((await call({ method: "POST", action: "submit", id: made.id })).body.message.status, "pending_approval");
  const approved = await call({ method: "POST", action: "approve", id: made.id });
  assert.equal(approved.body.message.status, "approved");
  assert.equal(approved.body.message.approvedBy, human.label);
  assert.ok(approved.body.message.sentAt == null);
  assert.equal((await store.transition({ id: made.id, userId: "user-a", to: "scheduled", actor: human })).message.status, "scheduled");
  await assert.rejects(() => store.transition({ id: made.id, userId: "user-a", to: "sent", actor: human }), (err) => err.status === 400);
  assert.equal((await call({ method: "POST", action: "cancel", id: made.id })).body.message.status, "canceled");
  await assert.rejects(() => store.transition({ id: made.id, userId: "user-a", to: "approved", actor: human }), (err) => err.status === 400);
  assert.equal(tables.messagingMessage.rows.some((row) => row.status === "sent"), false);

  const detail = await call({ method: "GET", action: "thread", id: made.threadId });
  assert.equal(detail.body.contact.email, "ada@example.com");
  assert.equal(detail.body.messages.length, 1);
  assert.deepEqual(detail.body.events.map((event) => event.action), ["created", "created", "edited", "submitted", "approved", "scheduled", "canceled"]);
  for (const event of detail.body.events) {
    assert.equal(event.actor, human.label);
    assert.match(event.at, /^\d{4}-\d{2}-\d{2}T/);
  }
  const contactEvents = tables.messagingEvent.rows.filter((row) => row.detail.kind === "contact");
  assert.equal(contactEvents.length, 1);
  assert.equal(contactEvents[0].actor, human.label);
  assert.ok(contactEvents[0].at instanceof Date);

  for (const [action, id] of [["contact", made.contactId], ["thread", made.threadId], ["draft", made.id]]) {
    assert.equal((await call({ method: "GET", token: "user-b", action, id })).status, 404, action);
  }
  assert.deepEqual((await call({ method: "GET", token: "user-b", action: "contacts" })).body.contacts, []);
  assert.deepEqual((await call({ method: "GET", token: "user-b", action: "threads" })).body.threads, []);
  assert.equal((await call({ method: "POST", token: "user-b", action: "approve", id: made.id })).status, 404);
});

test("a bot cannot approve and do-not-contact cannot advance", async () => {
  assert.equal((await call({ method: "POST", token: "mcp_test_key", action: "approve", id: "missing" })).status, 401);
  const made = await setup({ email: "bea@example.com", source: "bot", doNotContact: true });
  assert.equal((await call({ method: "POST", action: "submit", id: made.id })).body.message.status, "pending_approval");
  await assert.rejects(() => store.transition({ id: made.id, userId: "user-a", to: "approved", actor: { kind: "bot", label: "bot:apollo" } }), (err) => err.status === 403);
  const blocked = await call({ method: "POST", action: "approve", id: made.id });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /do-not-contact/);
  const row = tables.messagingMessage.rows.find((item) => item.id === made.id);
  assert.equal(row.status, "pending_approval");
  row.status = "approved";
  await assert.rejects(() => store.transition({ id: made.id, userId: "user-a", to: "scheduled", actor: human }), (err) => err.status === 400 && /do-not-contact/.test(err.message));
});
