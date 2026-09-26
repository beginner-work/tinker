/* GET /api/interview-decks
 *
 * Session auth, same Stytch check as the writing app. Rows are limited
 * to that user id. Without id, GET lists the owner's decks (topic and
 * timestamps). With ?id=, GET returns one deck including the full
 * transcript. A deck that belongs to someone else returns 404, not 403.
 * Read-only: no POST or PATCH. Saves go through the MCP tool.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { withResponseLogging } = require("./_lib/log.js");
const store = require("./_lib/interview-decks-store.js");

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
}

function queryValue(req, key) {
  const fromQuery = req.query && req.query[key];
  const value = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
  if (value != null && value !== "") return String(value);
  try {
    return new URL(req.url || "/", "http://localhost").searchParams.get(key) || "";
  } catch {
    return "";
  }
}

function presentList(row) {
  const transcript = Array.isArray(row.transcript) ? row.transcript : [];
  return {
    id: row.id,
    topic: row.topic,
    turnCount: transcript.length,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function presentDetail(row) {
  const transcript = Array.isArray(row.transcript) ? row.transcript : [];
  return {
    id: row.id,
    topic: row.topic,
    interviewKey: row.interviewKey,
    transcript,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

async function resolveUserId(req) {
  const session = await authenticateSession(extractBearer(req.headers && req.headers.authorization));
  const userId = userIdFromSession(session);
  if (!userId) throw Object.assign(new Error("Session missing user id."), { status: 401 });
  return userId;
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let userId;
  try {
    userId = await resolveUserId(req);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  try {
    const id = queryValue(req, "id");
    if (id) {
      const row = await store.getDeck({ id, userId });
      res.status(200).json({ deck: presentDetail(row) });
      return;
    }
    const decks = await store.listDecks({ userId });
    res.status(200).json({ decks: decks.map(presentList) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
});
