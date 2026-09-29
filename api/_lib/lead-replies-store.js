/* Lead replies synced by the assistant via MCP add_reply (TYL-66). */
"use strict";

const UNAVAILABLE = "Lead replies are unavailable right now.";
const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "LeadReply" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "leadId" TEXT NOT NULL, "gmailThreadId" TEXT NOT NULL DEFAULT '', "gmailMessageId" TEXT NOT NULL DEFAULT '', "fromAddress" TEXT NOT NULL DEFAULT '', "body" TEXT NOT NULL DEFAULT '', "receivedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "LeadReply_pkey" PRIMARY KEY ("id"))`,
  `CREATE INDEX IF NOT EXISTS "LeadReply_userId_idx" ON "LeadReply"("userId")`,
  `CREATE INDEX IF NOT EXISTS "LeadReply_leadId_idx" ON "LeadReply"("leadId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "LeadReply_userId_gmailMessageId_key" ON "LeadReply"("userId", "gmailMessageId")`,
];

let ensuring = null;
const db = () => require("./db.js");
const fail = (status, message) => Object.assign(new Error(message), { status });
function storeDown(err) {
  if (err && err.status) return err;
  return Object.assign(new Error(UNAVAILABLE), { status: 503, cause: err });
}
function requireUserId(userId) {
  if (typeof userId !== "string" || !userId.trim()) throw fail(401, "Sign in to tinker first.");
  return userId.trim();
}
function readText(value, label, max, required) {
  if (value == null || value === "") { if (required) throw fail(400, `${label} is required.`); return ""; }
  if (typeof value !== "string") throw fail(400, `${label} must be a string.`);
  const text = value.trim();
  if (required && !text) throw fail(400, `${label} is required.`);
  if (text.length > max) throw fail(400, `${label} is limited to ${max} characters.`);
  return text;
}
function readDate(value, label) {
  if (value == null || value === "") return new Date();
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string") throw fail(400, `${label} must be a date.`);
  const parsed = new Date(value.trim());
  if (Number.isNaN(parsed.getTime())) throw fail(400, `${label} must be a date.`);
  return parsed;
}
function iso(value) { return value ? new Date(value).toISOString() : null; }
function present(row) {
  return {
    id: row.id,
    leadId: row.leadId,
    gmailThreadId: row.gmailThreadId || "",
    gmailMessageId: row.gmailMessageId || "",
    from: row.fromAddress || "",
    body: row.body || "",
    receivedAt: iso(row.receivedAt),
    createdAt: iso(row.createdAt),
    channel: "gmail_outreach",
    side: "lead",
  };
}
async function ensureTable() {
  if (ensuring) return ensuring;
  ensuring = (async () => {
    for (const statement of TABLE_STATEMENTS) await db().$executeRawUnsafe(statement);
  })().catch((err) => {
    ensuring = null;
    throw Object.assign(new Error("Could not prepare the lead reply table."), { status: 503, cause: err });
  });
  return ensuring;
}
function resetTableCache() { ensuring = null; }

async function listForLead({ userId, leadId }) {
  const owner = requireUserId(userId);
  await ensureTable();
  let rows;
  try {
    rows = await db().leadReply.findMany({ where: { userId: owner, leadId: String(leadId || "").trim() } });
  } catch (err) { throw storeDown(err); }
  rows.sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt));
  return rows.map(present);
}

async function addReply({ userId, leadId, gmailThreadId, from, body, receivedAt, gmailMessageId }) {
  const owner = requireUserId(userId);
  await ensureTable();
  const msgId = readText(gmailMessageId, "gmailMessageId", 200, true);
  let existing;
  try {
    const all = await db().leadReply.findMany({ where: { userId: owner } });
    existing = all.find((row) => row.gmailMessageId === msgId) || null;
  } catch (err) { throw storeDown(err); }
  if (existing) return { reply: present(existing), deduped: true };

  let lead = null;
  const leadKey = readText(leadId, "leadId", 64, false);
  const threadKey = readText(gmailThreadId, "gmailThreadId", 200, false);
  if (!leadKey && !threadKey) throw fail(400, "leadId or gmailThreadId is required.");

  try {
    if (leadKey) {
      lead = await db().lead.findUnique({ where: { id: leadKey } });
      if (!lead || lead.userId !== owner) throw fail(404, "No lead with that id.");
    } else {
      const drafts = await db().leadDraft.findMany({ where: { userId: owner, gmailThreadId: threadKey } });
      const withLead = drafts.find((d) => d.leadId);
      if (!withLead) throw fail(404, "No Tinker thread for that Gmail thread id.");
      lead = await db().lead.findUnique({ where: { id: withLead.leadId } });
      if (!lead || lead.userId !== owner) throw fail(404, "No lead with that id.");
    }
  } catch (err) {
    if (err && err.status) throw err;
    throw storeDown(err);
  }

  const crypto = require("crypto");
  const row = {
    id: "reply_" + crypto.randomBytes(12).toString("hex"),
    userId: owner,
    leadId: lead.id,
    gmailThreadId: threadKey || "",
    gmailMessageId: msgId,
    fromAddress: readText(from, "from", 320, false).toLowerCase(),
    body: readText(body, "body", 100000, true),
    receivedAt: readDate(receivedAt, "receivedAt"),
    createdAt: new Date(),
  };
  try {
    const saved = await db().leadReply.create({ data: row });
    if (lead.stage === "new" || lead.stage === "drafting" || lead.stage === "contacted") {
      await db().lead.update({ where: { id: lead.id }, data: { stage: "replied" } });
    }
    return { reply: present(saved), deduped: false };
  } catch (err) {
    /* Unique race: treat as dedupe. */
    try {
      const all = await db().leadReply.findMany({ where: { userId: owner } });
      const again = all.find((r) => r.gmailMessageId === msgId);
      if (again) return { reply: present(again), deduped: true };
    } catch { /* fall through */ }
    throw storeDown(err);
  }
}

module.exports = {
  UNAVAILABLE, TABLE_STATEMENTS, ensureTable, resetTableCache, listForLead, addReply, present,
};
