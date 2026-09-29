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
  return title === "gtm approach" || title === "go-to-market approach" || title === "go to market approach";
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
    const { messages } = await readBlob(uid);
    messages.push(message);
    while (messages.length > MAX_MESSAGES) messages.shift();
    await writeBlob(uid, messages);
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
};
