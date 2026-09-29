/* Contacts, threads, and the approval outbox. Tables match
 * prisma/migrations/20260929020000_add_messaging and are created on first
 * use. Someone else's id is 404. Sent is rejected. A later sender must
 * stay behind MESSAGING_SEND_ENABLED (default off) and a sandbox mode.
 */

"use strict";

const SOURCES = ["apollo_import", "manual", "bot"];
const CHANNELS = ["email", "linkedin"];
const THREAD_STATUSES = ["open", "waiting", "replied", "booked", "closed"];
const NEXT = {
  draft: ["pending_approval", "canceled"],
  pending_approval: ["approved", "canceled"],
  approved: ["scheduled", "canceled"],
  scheduled: ["canceled"],
};
const ACTION_FOR = { pending_approval: "submitted", approved: "approved", scheduled: "scheduled", canceled: "canceled" };
const BLOCKED = new Set(["approved", "scheduled", "sent"]);
const UNAVAILABLE = "Messaging store is unavailable right now.";
const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "MessagingContact" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "email" TEXT NOT NULL, "name" TEXT NOT NULL DEFAULT '', "company" TEXT NOT NULL DEFAULT '', "title" TEXT NOT NULL DEFAULT '', "source" TEXT NOT NULL, "tags" JSONB NOT NULL DEFAULT '[]', "doNotContact" BOOLEAN NOT NULL DEFAULT false, "notes" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MessagingContact_pkey" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MessagingContact_userId_email_key" ON "MessagingContact"("userId", "email")`,
  `CREATE INDEX IF NOT EXISTS "MessagingContact_userId_idx" ON "MessagingContact"("userId")`,
  `CREATE TABLE IF NOT EXISTS "MessagingThread" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "contactId" TEXT NOT NULL, "channel" TEXT NOT NULL, "subject" TEXT NOT NULL DEFAULT '', "status" TEXT NOT NULL, "lastMessageAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MessagingThread_pkey" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "MessagingThread_userId_idx" ON "MessagingThread"("userId")`,
  `CREATE INDEX IF NOT EXISTS "MessagingThread_contactId_idx" ON "MessagingThread"("contactId")`,
  `CREATE TABLE IF NOT EXISTS "MessagingMessage" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "threadId" TEXT NOT NULL, "direction" TEXT NOT NULL, "status" TEXT NOT NULL, "subject" TEXT NOT NULL DEFAULT '', "body" TEXT NOT NULL DEFAULT '', "fromAddr" TEXT NOT NULL DEFAULT '', "toAddr" TEXT NOT NULL DEFAULT '', "cc" JSONB NOT NULL DEFAULT '[]', "scheduledAt" TIMESTAMP(3), "approvedAt" TIMESTAMP(3), "approvedBy" TEXT, "sentAt" TIMESTAMP(3), "providerMessageId" TEXT, "inReplyTo" TEXT, "draftKey" TEXT, "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MessagingMessage_pkey" PRIMARY KEY ("id"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MessagingMessage_userId_draftKey_key" ON "MessagingMessage"("userId", "draftKey")`,
  `CREATE INDEX IF NOT EXISTS "MessagingMessage_userId_idx" ON "MessagingMessage"("userId")`,
  `CREATE INDEX IF NOT EXISTS "MessagingMessage_threadId_idx" ON "MessagingMessage"("threadId")`,
  `CREATE TABLE IF NOT EXISTS "MessagingEvent" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "threadId" TEXT, "messageId" TEXT, "actor" TEXT NOT NULL, "action" TEXT NOT NULL, "detail" JSONB NOT NULL DEFAULT '{}', "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "MessagingEvent_pkey" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "MessagingEvent_userId_idx" ON "MessagingEvent"("userId")`,
  `CREATE INDEX IF NOT EXISTS "MessagingEvent_threadId_idx" ON "MessagingEvent"("threadId")`,
];

let ensuring = null;
const db = () => require("./db.js");
const fail = (status, message) => Object.assign(new Error(message), { status });

function requireUserId(userId) {
  if (typeof userId !== "string" || !userId.trim()) throw fail(401, "Sign in to tinker first.");
  return userId.trim();
}
function storeDown(err) {
  if (err && err.status) return err;
  return Object.assign(new Error(UNAVAILABLE), { status: 503, cause: err });
}
function actorLabel(actor) {
  const label = actor && typeof actor.label === "string" ? actor.label.trim() : "";
  if (actor && actor.kind === "human" && /^tyler:\S/.test(label)) return label;
  if (actor && actor.kind === "bot" && /^bot:\S/.test(label)) return label;
  if (actor && actor.kind === "system" && label === "system") return label;
  throw fail(401, "Missing actor.");
}
function readEnum(value, allowed, label) {
  const found = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!allowed.includes(found)) throw fail(400, `${label} must be ${allowed.join(" or ")}.`);
  return found;
}
function readText(value, label, max, required) {
  if (value == null || value === "") {
    if (required) throw fail(400, `${label} is required.`);
    return "";
  }
  if (typeof value !== "string") throw fail(400, `${label} must be a string.`);
  const text = value.trim();
  if (required && !text) throw fail(400, `${label} is required.`);
  if (text.length > max) throw fail(400, `${label} is limited to ${max} characters.`);
  return text;
}
function readEmail(value) {
  const email = readText(value, "email", 320, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, "email must be an email address.");
  return email;
}
function readBool(value) {
  if (value == null || value === false) return false;
  if (value === true) return true;
  throw fail(400, "doNotContact must be true or false.");
}
function readList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw fail(400, `${label} must be a list of strings.`);
  return value.map((item) => item.trim()).filter(Boolean);
}
function iso(value) {
  return value ? new Date(value).toISOString() : null;
}
function shape(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "userId") continue;
    out[key] = value instanceof Date ? iso(value) : value;
  }
  return out;
}
async function ensureTable() {
  if (ensuring) return ensuring;
  ensuring = (async () => {
    for (const statement of TABLE_STATEMENTS) await db().$executeRawUnsafe(statement);
  })().catch((err) => {
    ensuring = null;
    throw Object.assign(new Error("Could not prepare the messaging tables."), { status: 503, cause: err });
  });
  return ensuring;
}
function resetTableCache() { ensuring = null; }
async function commit(fn) {
  try { return await db().$transaction(fn); }
  catch (err) {
    if (err && (err.status || err.code === "P2002")) throw err;
    throw storeDown(err);
  }
}
async function findOne(model, where) {
  try { return await db()[model].findUnique({ where }); }
  catch (err) { throw storeDown(err); }
}
async function loadOwned(model, id, userId, label) {
  if (typeof id !== "string" || !id.trim()) throw fail(400, `${label} id is required.`);
  const row = await findOne(model, { id: id.trim() });
  if (!row || row.userId !== userId) throw fail(404, `No ${label} with that id.`);
  return row;
}
async function readyOwned(model, id, userId, label) {
  const owner = requireUserId(userId);
  await ensureTable();
  return loadOwned(model, id, owner, label);
}
async function listWhere(model, userId) {
  const owner = requireUserId(userId);
  await ensureTable();
  try {
    const rows = await db()[model].findMany({ where: { userId: owner } });
    return rows.sort((a, b) => new Date(b.updatedAt || b.at) - new Date(a.updatedAt || a.at));
  } catch (err) { throw storeDown(err); }
}
function eventData(fields) {
  return {
    userId: fields.userId, threadId: fields.threadId || null, messageId: fields.messageId || null,
    actor: fields.actor, action: fields.action, detail: fields.detail || {}, at: fields.at || new Date(),
  };
}
async function record(tx, fields) {
  await tx.messagingEvent.create({ data: eventData(fields) });
}

async function createContact(input) {
  const owner = requireUserId(input.userId);
  const actor = actorLabel(input.actor);
  const data = {
    userId: owner, email: readEmail(input.email), name: readText(input.name, "name", 200, false),
    company: readText(input.company, "company", 200, false), title: readText(input.title, "title", 200, false),
    source: readEnum(input.source, SOURCES, "source"), tags: readList(input.tags, "tags"),
    doNotContact: readBool(input.doNotContact), notes: readText(input.notes, "notes", 8000, false),
  };
  await ensureTable();
  const where = { userId_email: { userId: owner, email: data.email } };
  const existing = await findOne("messagingContact", where);
  if (existing) return { row: existing, created: false };
  const row = await commit(async (tx) => {
    const saved = await tx.messagingContact.create({ data });
    await record(tx, { userId: owner, actor, action: "created", detail: { kind: "contact", contactId: saved.id, doNotContact: data.doNotContact } });
    return saved;
  });
  return { row, created: true };
}
async function createThread(input) {
  const owner = requireUserId(input.userId);
  const actor = actorLabel(input.actor);
  await ensureTable();
  const contact = await loadOwned("messagingContact", input.contactId, owner, "contact");
  const data = {
    userId: owner, contactId: contact.id, channel: readEnum(input.channel, CHANNELS, "channel"),
    subject: readText(input.subject, "subject", 300, false),
    status: input.status == null || input.status === "" ? "open" : readEnum(input.status, THREAD_STATUSES, "status"),
  };
  const row = await commit(async (tx) => {
    const saved = await tx.messagingThread.create({ data });
    await record(tx, { userId: owner, threadId: saved.id, actor, action: "created", detail: { kind: "thread", contactId: contact.id } });
    return saved;
  });
  return { row, created: true };
}
async function getThread({ id, userId }) {
  const owner = requireUserId(userId);
  await ensureTable();
  const thread = await loadOwned("messagingThread", id, owner, "thread");
  const contact = await loadOwned("messagingContact", thread.contactId, owner, "contact");
  let messages; let events;
  try {
    messages = await db().messagingMessage.findMany({ where: { userId: owner, threadId: thread.id } });
    events = await db().messagingEvent.findMany({ where: { userId: owner, threadId: thread.id } });
  } catch (err) { throw storeDown(err); }
  messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  events.sort((a, b) => new Date(a.at) - new Date(b.at));
  return { thread, contact, messages, events };
}
async function createDraft(input) {
  const owner = requireUserId(input.userId);
  const actor = actorLabel(input.actor);
  if (input.direction != null && input.direction !== "" && input.direction !== "outbound") throw fail(400, "Only an outbound draft can be created.");
  if (input.status != null && input.status !== "" && input.status !== "draft") throw fail(400, "A new message starts as a draft.");
  const draftKey = readText(input.draftKey, "draftKey", 200, false) || null;
  await ensureTable();
  const thread = await loadOwned("messagingThread", input.threadId, owner, "thread");
  const keyWhere = { userId_draftKey: { userId: owner, draftKey } };
  if (draftKey) {
    const existing = await findOne("messagingMessage", keyWhere);
    if (existing) return { row: existing, created: false };
  }
  const now = new Date();
  const data = {
    userId: owner, threadId: thread.id, direction: "outbound", status: "draft", createdBy: actor, draftKey,
    subject: readText(input.subject, "subject", 300, false), body: readText(input.body, "body", 100000, false),
    fromAddr: readText(input.fromAddr, "fromAddr", 320, false), toAddr: readText(input.toAddr, "toAddr", 320, false),
    cc: readList(input.cc, "cc"), inReplyTo: readText(input.inReplyTo, "inReplyTo", 200, false) || null,
  };
  const row = await commit(async (tx) => {
    const saved = await tx.messagingMessage.create({ data });
    await tx.messagingThread.update({ where: { id: thread.id }, data: { lastMessageAt: now } });
    await record(tx, { userId: owner, threadId: thread.id, messageId: saved.id, actor, action: "created", detail: { kind: "message" }, at: now });
    return saved;
  });
  return { row, created: true };
}
async function updateDraft({ id, userId, actor, patch }) {
  const owner = requireUserId(userId);
  const label = actorLabel(actor);
  const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const fields = ["subject", "body", "fromAddr", "toAddr", "cc"].filter((key) => Object.prototype.hasOwnProperty.call(source, key));
  if (!fields.length) throw fail(400, "Nothing to update.");
  await ensureTable();
  const row = await loadOwned("messagingMessage", id, owner, "message");
  if (row.status !== "draft") throw fail(400, "Only a draft can be edited.");
  const limits = { subject: 300, body: 100000, fromAddr: 320, toAddr: 320 };
  const data = {};
  for (const key of fields) data[key] = key === "cc" ? readList(source.cc, "cc") : readText(source[key], key, limits[key], false);
  const now = new Date();
  return commit(async (tx) => {
    const saved = await tx.messagingMessage.update({ where: { id: row.id }, data });
    await record(tx, { userId: owner, threadId: row.threadId, messageId: row.id, actor: label, action: "edited", detail: { kind: "message", fields }, at: now });
    return saved;
  });
}
async function transition({ id, userId, to, actor, scheduledAt }) {
  const owner = requireUserId(userId);
  const label = actorLabel(actor);
  if (typeof to !== "string" || to === "sent" || to === "failed" || to === "received") throw fail(400, "That status is not available.");
  await ensureTable();
  const row = await loadOwned("messagingMessage", id, owner, "message");
  if (!(NEXT[row.status] || []).includes(to)) throw fail(400, `Cannot move a message from ${row.status} to ${to}.`);
  if (to === "approved" && actor.kind !== "human") throw fail(403, "Only a signed-in person can approve.");
  const thread = await loadOwned("messagingThread", row.threadId, owner, "thread");
  const contact = await loadOwned("messagingContact", thread.contactId, owner, "contact");
  if (contact.doNotContact && BLOCKED.has(to)) throw fail(400, "This contact is do-not-contact.");
  const now = new Date();
  const when = scheduledAt == null || scheduledAt === "" ? now : new Date(scheduledAt);
  if (to === "scheduled" && Number.isNaN(when.getTime())) throw fail(400, "scheduledAt must be a time.");
  const data = { status: to };
  if (to === "approved") { data.approvedAt = now; data.approvedBy = label; }
  if (to === "scheduled") data.scheduledAt = when;
  return commit(async (tx) => {
    const message = await tx.messagingMessage.update({ where: { id: row.id }, data });
    await tx.messagingThread.update({ where: { id: thread.id }, data: { lastMessageAt: now } });
    const event = await tx.messagingEvent.create({ data: eventData({
      userId: owner, threadId: thread.id, messageId: row.id, actor: label, action: ACTION_FOR[to],
      detail: { from: row.status, to }, at: now,
    }) });
    return { message, event };
  });
}

module.exports = {
  UNAVAILABLE, TABLE_STATEMENTS, ensureTable, resetTableCache,
  presentContact: shape, presentThread: shape, presentMessage: shape, presentEvent: shape,
  presentDetail({ thread, contact, messages, events }) {
    return { thread: shape(thread), contact: shape(contact), messages: messages.map(shape), events: events.map(shape) };
  },
  createContact, createThread, createDraft, updateDraft, transition, getThread,
  listContacts: ({ userId }) => listWhere("messagingContact", userId),
  getContact: ({ id, userId }) => readyOwned("messagingContact", id, userId, "contact"),
  listThreads: ({ userId }) => listWhere("messagingThread", userId),
  getMessage: ({ id, userId }) => readyOwned("messagingMessage", id, userId, "message"),
};
