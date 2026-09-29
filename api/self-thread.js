/* GET/POST /api/self-thread
 *
 * Owner route for the You inbox thread. MCP bots post via post_to_self_thread;
 * the signed-in owner lists messages here for the renderer.
 *
 * GET  ?action=list → { messages: [...] }
 * POST ?action=post body { title, body } → { message } (optional owner write)
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { withResponseLogging } = require("./_lib/log.js");
const store = require("./_lib/self-thread-store.js");

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
    throw Object.assign(new Error("Connector credentials use post_to_self_thread on /api/mcp."), { status: 401 });
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

async function dispatch(method, action, auth, body) {
  const { userId } = auth;
  if (method === "GET" && (action === "list" || action === "")) {
    return { status: 200, body: { messages: await store.listMessages({ userId, limit: 100 }) } };
  }
  if (method === "POST" && (action === "post" || action === "")) {
    const message = await store.postMessage({
      userId,
      title: body.title,
      body: body.body,
      source: "owner",
    });
    return { status: 201, body: { message } };
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
  let body = {};
  try { if (req.method === "POST") body = readBody(req); }
  catch (err) {
    send(res, err.status || 400, { error: err.message || "Invalid JSON" });
    return;
  }
  try {
    const result = await dispatch(req.method, action, auth, body);
    send(res, result.status, result.body);
  } catch (err) {
    send(res, err.status || 500, { error: err.message || store.UNAVAILABLE });
  }
});
