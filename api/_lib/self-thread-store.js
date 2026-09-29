/* Owner self-thread messages posted by MCP (or the owner API).
 *
 * One TinkerUserData row per user, kind "self_thread". Messages are an
 * append-only list the You inbox thread renders as incoming assistant
 * bubbles. No send path.
 */

"use strict";

const crypto = require("crypto");

const KIND = "self_thread";
const UNAVAILABLE = "Self thread is unavailable right now.";
const MAX_TITLE = 200;
const MAX_BODY = 50000;
const MAX_MESSAGES = 200;

function db() {
  return require("./db.js");
}

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function requireUserId(userId) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw fail(401, "Sign in to tinker first.");
  }
  return userId.trim();
}

function storeDown(err) {
  if (err && err.status) return err;
  return Object.assign(new Error(UNAVAILABLE), { status: 503, cause: err });
}

function trimTitle(value) {
  const title = String(value == null ? "" : value).trim();
  if (!title) throw fail(400, "title is required.");
  if (title.length > MAX_TITLE) throw fail(400, "title is too long.");
  return title;
}

function trimBody(value) {
  const body = String(value == null ? "" : value);
  if (!body.trim()) throw fail(400, "body is required.");
  if (body.length > MAX_BODY) throw fail(400, "body is too long.");
  return body;
}

function newId() {
  return "self_" + crypto.randomBytes(8).toString("hex");
}

function present(message) {
  return {
    id: message.id,
    title: message.title,
    body: message.body,
    createdAt: message.createdAt,
    source: message.source || "mcp",
  };
}

async function readBlob(userId) {
  const prisma = db();
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind: KIND } },
  });
  const data = row && row.data && typeof row.data === "object" ? row.data : {};
  const messages = Array.isArray(data.messages) ? data.messages : [];
  return { messages, updatedAt: row ? row.updatedAt : null };
}

async function writeBlob(userId, messages) {
  const prisma = db();
  const data = { messages };
  await prisma.tinkerUserData.upsert({
    where: { userId_kind: { userId, kind: KIND } },
    create: { userId, kind: KIND, data },
    update: { data },
  });
}

function isPlanDump(message) {
  const title = String(message && message.title || "").trim().toLowerCase();
  if (!title) return false;
  if (title.includes("gtm approach")) return true;
  if (title.includes("go-to-market approach") || title.includes("go to market approach")) return true;
  if (title.startsWith("your gtm")) return true;
  const body = String(message && message.body || "").toLowerCase();
  // Known production dump shape: title mentions GTM / plan prose with North Star waves.
  if (title.includes("gtm") && (body.includes("north star") || body.includes("wave 1"))) return true;
  // Deploy / ops status chatter does not belong in the owner's story thread.
  if (title.includes("deploy check") || title.includes("deploy status")) return true;
  if (title.includes("lead tools deploy")) return true;
  if (/\bdeploy\b/.test(title) && (
    body.includes("production is on")
    || body.includes("allowlist")
    || body.includes("gate removed")
    || body.includes("leads_owner_allowlist")
  )) return true;
  if (body.includes("leads_owner_allowlist") && (body.includes("gate") || body.includes("removed"))) return true;
  if (body.includes("production is on") && (body.includes("gate") || body.includes("allowlist") || /\b[0-9a-f]{7,40}\b/.test(body))) {
    return true;
  }
  return false;
}

async function purgePlanDumps(userId, messages) {
  const kept = messages.filter((msg) => !isPlanDump(msg));
  if (kept.length !== messages.length) await writeBlob(userId, kept);
  return kept;
}

async function listMessages({ userId, limit } = {}) {
  try {
    const uid = requireUserId(userId);
    const { messages } = await readBlob(uid);
    const cleaned = await purgePlanDumps(uid, messages);
    const cap = Math.min(Math.max(Number(limit) || 50, 1), MAX_MESSAGES);
    return cleaned.slice(-cap).map(present);
  } catch (err) {
    throw storeDown(err);
  }
}

/** Hard-delete every plan-dump message for this user. Returns how many were removed. */
async function purgePlanMessages({ userId } = {}) {
  try {
    const uid = requireUserId(userId);
    const { messages } = await readBlob(uid);
    const kept = messages.filter((msg) => !isPlanDump(msg));
    const removed = messages.length - kept.length;
    if (removed > 0) await writeBlob(uid, kept);
    return { removed, remaining: kept.length };
  } catch (err) {
    throw storeDown(err);
  }
}

async function postMessage({ userId, title, body, source } = {}) {
  try {
    const uid = requireUserId(userId);
    const message = {
      id: newId(),
      title: trimTitle(title),
      body: trimBody(body),
      createdAt: new Date().toISOString(),
      source: source === "owner" ? "owner" : "mcp",
    };
    if (isPlanDump(message)) {
      throw fail(400, "Do not post GTM plans, deploy notes, or ops status to the You thread. Use upsert_target_company and upsert_lead_person for lead work.");
    }
    const { messages } = await readBlob(uid);
    // Drop any legacy plan dumps before appending a short note.
    const cleaned = messages.filter((msg) => !isPlanDump(msg));
    cleaned.push(message);
    while (cleaned.length > MAX_MESSAGES) cleaned.shift();
    await writeBlob(uid, cleaned);
    return present(message);
  } catch (err) {
    throw storeDown(err);
  }
}

module.exports = {
  KIND,
  UNAVAILABLE,
  MAX_TITLE,
  MAX_BODY,
  present,
  listMessages,
  postMessage,
  isPlanDump,
  purgePlanMessages,
};
