/* GET/PUT/DELETE /api/reflection-webhook — owner webhook secrets (hints only on read). */
"use strict";
const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { withResponseLogging } = require("./_lib/log.js");
const store = require("./_lib/reflection-webhook-store.js");

function bearer(header) {
  const m = header && String(header).match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
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
    throw Object.assign(new Error("Connector credentials use set_reflection_webhook on /api/mcp."), { status: 401 });
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

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "PUT" && req.method !== "DELETE") {
    res.setHeader("Allow", "GET, PUT, DELETE");
    send(res, 405, { error: "Method not allowed" });
    return;
  }
  let auth;
  try { auth = await resolve(req); }
  catch (err) { send(res, err.status || 401, { error: err.message || "Unauthorized" }); return; }
  try {
    if (req.method === "GET") { send(res, 200, await store.getPublic({ userId: auth.userId })); return; }
    if (req.method === "DELETE") { send(res, 200, await store.clearWebhook({ userId: auth.userId })); return; }
    const body = readBody(req);
    send(res, 200, await store.setWebhook({
      userId: auth.userId, url: body.url, authorization: body.authorization,
    }));
  } catch (err) {
    send(res, err.status || 500, { error: err.message || store.UNAVAILABLE });
  }
});
