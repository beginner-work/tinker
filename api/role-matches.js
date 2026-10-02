/* GET/POST /api/role-matches
 *
 * Owner route for overview role matches. MCP bots save/list via
 * save_role_match / list_role_matches on /api/mcp.
 *
 * GET  ?action=list → { roles }
 * POST ?action=dismiss &id= → { role }
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { withResponseLogging } = require("./_lib/log.js");
const store = require("./_lib/role-matches-store.js");

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
    throw Object.assign(new Error("Connector credentials use role tools on /api/mcp."), { status: 401 });
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
    return { status: 200, body: { roles: await store.listRoleMatches({ userId }) } };
  }
  if (method === "POST" && action === "dismiss") {
    return {
      status: 200,
      body: {
        role: await store.dismissRoleMatch({
          userId,
          roleId: id || body.roleId,
          postingUrl: body.postingUrl,
        }),
      },
    };
  }
  throw Object.assign(new Error("Unknown action."), { status: 404 });
}

async function handler(req, res) {
  try {
    const method = String(req.method || "GET").toUpperCase();
    if (method !== "GET" && method !== "POST") {
      send(res, 405, { error: "Method not allowed." });
      return;
    }
    const auth = await resolve(req);
    const action = queryValue(req, "action") || "";
    const id = queryValue(req, "id") || "";
    const body = method === "POST" ? readBody(req) : {};
    const result = await dispatch(method, action, auth, body, id);
    send(res, result.status, result.body);
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    send(res, status, { error: (err && err.message) || "Request failed." });
  }
}

module.exports = withResponseLogging("role-matches", handler);
