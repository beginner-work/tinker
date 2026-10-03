/* GET /api/self-reflections
 *
 * Owner route for the same rows MCP list_self_reflections returns
 * (You-thread posts + synced essays + in-progress drafts). The /repo
 * page lists them as Markdown files. MCP tools stay on /api/mcp.
 *
 * GET ?action=list → { reflections: [...] }
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { withResponseLogging } = require("./_lib/log.js");
const reflections = require("./_lib/self-reflections.js");

function bearer(header) {
  const match = header && String(header).match(/^Bearer\s+(\S+)$/i);
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

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

async function resolve(req) {
  const token = bearer(req.headers && req.headers.authorization);
  if (!token) throw Object.assign(new Error("Sign in to tinker first."), { status: 401 });
  if (token.startsWith("mcp_")) {
    throw Object.assign(
      new Error("Connector credentials use list_self_reflections on /api/mcp."),
      { status: 401 }
    );
  }
  let session;
  try {
    session = await authenticateSession(token);
  } catch (err) {
    if (err.status && err.status >= 400 && err.status < 500) {
      throw Object.assign(new Error("Session expired."), { status: 401 });
    }
    throw err;
  }
  const userId = userIdFromSession(session);
  if (!userId) throw Object.assign(new Error("Session missing user id."), { status: 401 });
  return { userId };
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    send(res, 405, { error: "Method not allowed" });
    return;
  }
  let auth;
  try {
    auth = await resolve(req);
  } catch (err) {
    send(res, err.status || 401, { error: err.message || "Unauthorized" });
    return;
  }
  const action = queryValue(req, "action") || "list";
  if (action !== "list") {
    send(res, 404, { error: "Unknown action." });
    return;
  }
  try {
    const limitRaw = queryValue(req, "limit");
    const since = queryValue(req, "since") || undefined;
    const limit = limitRaw ? Number(limitRaw) : reflections.MAX_LIMIT;
    const rows = await reflections.listSelfReflections({
      userId: auth.userId,
      since,
      limit: Number.isFinite(limit) ? limit : reflections.MAX_LIMIT,
    });
    send(res, 200, { reflections: rows });
  } catch (err) {
    send(res, err.status || 500, { error: err.message || reflections.UNAVAILABLE });
  }
});
