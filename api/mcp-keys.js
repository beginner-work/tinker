/* GET|POST|DELETE /api/mcp-keys
 *
 * Owner-only mint, list, and revoke for durable MCP API keys.
 * One serverless function on purpose: mint and revoke share this route.
 *
 * Authorization: Bearer <stytch session_token | session_jwt>
 * The caller must be MCP_KEY_OWNER_USER_ID. The plaintext key is
 * returned once, on POST, and is not written to preview logs.
 *
 *   POST   { "label": "clay" }  -> { id, label, createdAt, key, note }
 *   GET                         -> { userId, keys: [{ id, label, createdAt, revokedAt }] }
 *   DELETE { "id": "<id>" }     -> { id, label, createdAt, revokedAt }
 *
 * Clay then sends Authorization: Bearer <mcp_...> to POST /api/mcp.
 * That header does not use a Stytch session.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const {
  assertOwner,
  isMcpApiKey,
  mintMcpKey,
  revokeMcpKey,
  listMcpKeys,
  userIdFromSession,
} = require("./_lib/mcp-keys.js");

const NOTE = "Copy this key now. It will not be shown again.";

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function readJsonBody(req) {
  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    if (!body.trim()) return {};
    try {
      body = JSON.parse(body);
    } catch {
      throw Object.assign(new Error("Invalid JSON"), { status: 400 });
    }
  }
  if (body == null) return {};
  if (typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
  return body;
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function publicKey(row) {
  return {
    id: row.id,
    label: row.label,
    createdAt: iso(row.createdAt),
    revokedAt: row.revokedAt ? iso(row.revokedAt) : null,
  };
}

function sendError(res, err) {
  const status = err.status || 500;
  const body = { error: err.message || "Internal error" };
  if (err.userId && status === 503) body.userId = err.userId;
  res.status(status).json(body);
}

async function resolveUserId(req) {
  const token = extractBearer(req.headers && req.headers.authorization);
  // A key that can call /api/mcp must not be able to mint or revoke,
  // and must not be forwarded to Stytch.
  if (isMcpApiKey(token)) {
    throw Object.assign(
      new Error("MCP API keys cannot manage keys. Use a Stytch session."),
      { status: 401 },
    );
  }
  const session = await authenticateSession(token);
  const userId = userIdFromSession(session);
  if (!userId) {
    throw Object.assign(new Error("Session missing user id."), { status: 401 });
  }
  return userId;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "GET, POST, DELETE");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let userId;
  try {
    userId = await resolveUserId(req);
    assertOwner(userId);
  } catch (err) {
    sendError(res, err);
    return;
  }

  try {
    if (req.method === "GET") {
      const keys = await listMcpKeys();
      res.status(200).json({ userId, keys: keys.map(publicKey) });
      return;
    }

    const body = readJsonBody(req);
    if (req.method === "POST") {
      const minted = await mintMcpKey({ label: body.label });
      res.status(200).json({
        id: minted.id,
        label: minted.label,
        createdAt: iso(minted.createdAt),
        key: minted.key,
        note: NOTE,
      });
      return;
    }

    const id = (body && body.id) || (req.query && req.query.id) || "";
    const revoked = await revokeMcpKey(id);
    res.status(200).json(publicKey(revoked));
  } catch (err) {
    sendError(res, err);
  }
};
