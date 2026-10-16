/* GET /api/inflight
 *
 * Lists in-flight Cursor cloud agents for the signed-in owner.
 * Uses CURSOR_API_KEY server-side only (never returned to the client).
 * When the key is missing, returns an empty configured:false payload
 * (clear empty state, not an error). Upstream timeouts / failures return
 * 504/502 so the PWA can show Retry instead of hanging on Loading.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { withResponseLogging } = require("./_lib/log.js");
const inflight = require("./_lib/inflight-agents.js");

function bearer(header) {
  const match = header && String(header).match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
}

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

async function resolve(req) {
  const token = bearer(req.headers && req.headers.authorization);
  if (!token) throw Object.assign(new Error("Sign in to tinker first."), { status: 401 });
  if (token.startsWith("mcp_")) {
    throw Object.assign(new Error("Connector credentials cannot list in-flight agents."), {
      status: 401,
    });
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
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    send(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    await resolve(req);
  } catch (err) {
    send(res, err.status || 401, { error: err.message || "Unauthorized" });
    return;
  }

  try {
    const payload = await inflight.listInflightAgents();
    send(res, 200, payload);
  } catch (err) {
    const status = err && err.status
      ? err.status
      : (err && err.code === "timeout" ? 504 : 502);
    send(res, status >= 400 && status < 600 ? status : 502, {
      error: err && err.message ? String(err.message) : "Could not load in-flight agents.",
      code: err && err.code ? String(err.code) : undefined,
    });
  }
});
