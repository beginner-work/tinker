/* GET/POST /api/reading-thread
 *
 * Owner route for generic reading workbook threads. MCP bots create and
 * advance via create_reading_thread / get_reading_thread /
 * advance_reading_section on /api/mcp. Notes use the same merge-safe
 * notepad contract as leads (#395).
 *
 * GET  ?action=list → { threads }
 * GET  ?action=get&id= → { thread }
 * POST ?action=edit body { notes } &id= → { thread }
 * POST ?action=advance body { notes? } &id= → { thread }
 * POST ?action=retreat &id= → { thread } (go back one section; notes kept)
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { withResponseLogging } = require("./_lib/log.js");
const store = require("./_lib/reading-thread-store.js");

function bearer(header) {
  const match = header && String(header).match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
}
function queryValue(req, key) {
  const fromQuery = req.query && req.query[key];
  const value = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
  if (value != null && value !== "") return String(value);
  try { return new URL(req.url || "/", "http://localhost").searchParams.get(key) || ""; }
  catch { return ""; }
}
function readBody(req) {
  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    if (!body.trim()) return {};
    try { body = JSON.parse(body); } catch { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); }
  }
  if (body == null) return {};
  if (typeof body !== "object" || Array.isArray(body)) throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  return body;
}
function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}
async function resolve(req) {
  const token = bearer(req.headers && req.headers.authorization);
  if (!token) throw Object.assign(new Error("Sign in to tinker first."), { status: 401 });
  if (token.startsWith("mcp_")) {
    throw Object.assign(new Error("Connector credentials use reading tools on /api/mcp."), { status: 401 });
  }
  let session;
  try { session = await authenticateSession(token); }
  catch (err) {
    if (err.status && err.status >= 400 && err.status < 500) {
      throw Object.assign(new Error("Session expired."), { status: 401 });
    }
    throw err;
  }
  const userId = userIdFromSession(session);
  if (!userId) throw Object.assign(new Error("Session missing user id."), { status: 401 });
  return { userId };
}

async function dispatch(method, action, auth, body, id) {
  const { userId } = auth;
  if (method === "GET" && (action === "list" || action === "")) {
    return { status: 200, body: { threads: await store.listThreads({ userId }) } };
  }
  if (method === "GET" && action === "get") {
    return { status: 200, body: { thread: await store.getThread({ userId, threadId: id }) } };
  }
  if (method === "POST" && action === "edit") {
    return {
      status: 200,
      body: { thread: await store.updateNotes({ userId, threadId: id, notes: body.notes }) },
    };
  }
  if (method === "POST" && action === "advance") {
    return {
      status: 200,
      body: {
        thread: await store.advanceSection({
          userId,
          threadId: id,
          notes: Object.prototype.hasOwnProperty.call(body, "notes") ? body.notes : undefined,
        }),
      },
    };
  }
  if (method === "POST" && action === "retreat") {
    return {
      status: 200,
      body: { thread: await store.retreatSection({ userId, threadId: id }) },
    };
  }
  return { status: 404, body: { error: "Unknown action." } };
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    send(res, 405, { error: "Method not allowed" });
    return;
  }
  let auth;
  try { auth = await resolve(req); }
  catch (err) {
    send(res, err.status || 401, { error: err.message || "Unauthorized" });
    return;
  }
  const action = queryValue(req, "action");
  const id = queryValue(req, "id");
  let body = {};
  try { if (req.method === "POST") body = readBody(req); }
  catch (err) {
    send(res, err.status || 400, { error: err.message || "Invalid JSON" });
    return;
  }
  try {
    const result = await dispatch(req.method, action, auth, body, id);
    send(res, result.status, result.body);
  } catch (err) {
    send(res, err.status || 500, { error: err.message || store.UNAVAILABLE });
  }
});
