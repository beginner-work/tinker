/* Read the owner's self-reflections for MCP assistants.
 *
 * Sources (same userId only):
 *   - You-thread messages (self_thread): bot posts and owner posts
 *   - Synced essays (user-data kind "essays"): published reflections
 *   - Synced drafts (user-data kind "drafts"): in-progress writing with text
 *
 * Newest first. Optional since (ISO) and limit. Never crosses owners.
 */

"use strict";

const selfThread = require("./self-thread-store.js");

const UNAVAILABLE = "Self reflections are unavailable right now.";
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

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

function toIso(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : "";
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  }
  const s = String(value).trim();
  if (!s) return "";
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : s;
}

function parseSince(since) {
  if (since == null || since === "") return null;
  const iso = toIso(since);
  if (!iso) throw fail(400, "since must be an ISO date.");
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw fail(400, "since must be an ISO date.");
  return ms;
}

function presentReflection({ id, title, body, createdAt, updatedAt }) {
  const created = toIso(createdAt) || new Date(0).toISOString();
  const updated = toIso(updatedAt) || created;
  return {
    id: String(id || ""),
    title: String(title == null ? "" : title),
    body: String(body == null ? "" : body),
    createdAt: created,
    updatedAt: updated,
  };
}

function draftBody(draft) {
  if (!draft || typeof draft !== "object") return "";
  if (draft.stitched && typeof draft.stitched.body === "string" && draft.stitched.body.trim()) {
    return draft.stitched.body;
  }
  const scratch = draft._scratch != null ? String(draft._scratch) : "";
  if (scratch.trim()) return scratch;
  const turns = Array.isArray(draft.transcript) ? draft.transcript : [];
  const lines = [];
  turns.forEach((turn) => {
    if (!turn || typeof turn !== "object") return;
    const q = String(turn.q || "").trim();
    const a = String(turn.a || "").trim();
    if (!q && !a) return;
    if (q) lines.push("### " + q);
    if (a) lines.push(a);
    lines.push("");
  });
  return lines.join("\n").trim();
}

function draftTitle(draft) {
  if (!draft || typeof draft !== "object") return "Untitled";
  if (draft.stitched && draft.stitched.title) return String(draft.stitched.title);
  if (draft.title) return String(draft.title);
  return "Untitled draft";
}

async function readUserBlob(userId, kind) {
  const prisma = db();
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind } },
  });
  return row && row.data != null ? row.data : null;
}

function fromSelfThread(messages) {
  return (Array.isArray(messages) ? messages : []).map((msg) => presentReflection({
    id: msg.id,
    title: msg.title,
    body: msg.body,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt || msg.createdAt,
  }));
}

function fromEssays(data) {
  const rows = Array.isArray(data) ? data : [];
  return rows
    .filter((essay) => essay && essay.id && String(essay.body || "").trim())
    .map((essay) => presentReflection({
      id: essay.id,
      title: essay.title == null || essay.title === "" ? "Untitled" : essay.title,
      body: essay.body,
      createdAt: essay.createdAt,
      updatedAt: essay.updatedAt || essay.createdAt,
    }));
}

function fromDrafts(data) {
  const rows = Array.isArray(data) ? data : [];
  return rows
    .map((draft) => {
      if (!draft || !draft.id) return null;
      const body = draftBody(draft);
      if (!body.trim()) return null;
      return presentReflection({
        id: draft.id,
        title: draftTitle(draft),
        body,
        createdAt: draft.createdAt || draft.updatedAt,
        updatedAt: draft.updatedAt || draft.createdAt,
      });
    })
    .filter(Boolean);
}

async function listSelfReflections({ userId, since, limit } = {}) {
  try {
    const uid = requireUserId(userId);
    const sinceMs = parseSince(since);
    const cap = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

    const [threadMessages, essaysData, draftsData] = await Promise.all([
      selfThread.listMessages({ userId: uid, limit: MAX_LIMIT }),
      readUserBlob(uid, "essays"),
      readUserBlob(uid, "drafts"),
    ]);

    const combined = []
      .concat(fromSelfThread(threadMessages))
      .concat(fromEssays(essaysData))
      .concat(fromDrafts(draftsData));

    const filtered = sinceMs == null
      ? combined
      : combined.filter((row) => {
        const stamp = Date.parse(row.updatedAt || row.createdAt);
        return Number.isFinite(stamp) && stamp >= sinceMs;
      });

    filtered.sort((a, b) => {
      const tb = Date.parse(b.updatedAt || b.createdAt) || 0;
      const ta = Date.parse(a.updatedAt || a.createdAt) || 0;
      if (tb !== ta) return tb - ta;
      return String(b.id).localeCompare(String(a.id));
    });

    return filtered.slice(0, cap);
  } catch (err) {
    throw storeDown(err);
  }
}

module.exports = {
  UNAVAILABLE,
  MAX_LIMIT,
  DEFAULT_LIMIT,
  listSelfReflections,
  presentReflection,
  draftBody,
};
