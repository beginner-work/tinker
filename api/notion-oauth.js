/* Notion public-integration OAuth (Connect Notion for essay sync).
 *
 * GET    /api/notion-oauth                 — status { connected, configured, parentPageId, … }
 * POST   /api/notion-oauth?action=connect  — start OAuth → { authorizeUrl }
 * GET    /api/notion-oauth?action=callback — OAuth redirect target
 * POST   /api/notion-oauth?action=set-parent — { parentPageId | url }
 * DELETE /api/notion-oauth?action=disconnect
 * POST   /api/notion-oauth?action=disconnect
 *
 * Tokens live in Postgres (TinkerUserData), encrypted. Not Upstash.
 * Distinct from /api/connections Notion MCP connector.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { withResponseLogging } = require("./_lib/log.js");
const store = require("./_lib/notion-token-store.js");

function bearer(header) {
  const m = header && String(header).match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function queryParams(req) {
  const out = {};
  try {
    const url = new URL(req.url || "/", "https://tinker.local");
    for (const [key, value] of url.searchParams) out[key] = value;
  } catch {
    /* ignore */
  }
  if (req.query && typeof req.query === "object") {
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") out[key] = value;
    }
  }
  return out;
}

function readBody(req) {
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

function sendJson(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

function sendHtml(res, status, html) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.end(html);
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function callbackPage({ ok, message }) {
  const title = ok ? "Connected" : "Connection failed";
  const dest = ok
    ? "/connections?notion=connected"
    : "/connections?notion_error=" + encodeURIComponent(message || "failed");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <meta http-equiv="refresh" content="0;url=${escapeHtml(dest)}" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/design-tokens.css" />
  <link rel="stylesheet" href="/styles.css" />
  <style>
    body.notion-cb {
      margin: 0; min-height: 100dvh; display: flex; align-items: center;
      justify-content: center; background: var(--color-background, #fffdf7);
      color: var(--color-foreground, #2d2a26);
      font-family: var(--font-sans, system-ui, sans-serif); padding: 24px;
    }
    .notion-cb__card { max-width: 28rem; text-align: center; }
    .notion-cb__title {
      margin: 0 0 12px; font-family: var(--font-display, inherit);
      font-size: 28px; letter-spacing: -0.02em;
    }
    .notion-cb__msg { color: var(--color-muted, #6f6a65); font-size: 15px; line-height: 1.45; }
  </style>
</head>
<body class="notion-cb">
  <main class="notion-cb__card">
    <h1 class="notion-cb__title">${escapeHtml(title)}</h1>
    <p class="notion-cb__msg">${escapeHtml(message || (ok ? "Returning to Connections…" : "Try again from Connections."))}</p>
    <p class="notion-cb__msg"><a href="${escapeHtml(dest)}">Continue</a></p>
  </main>
  <script>location.replace(${JSON.stringify(dest)});</script>
</body>
</html>`;
}

async function requireSessionUser(req) {
  const token = bearer(req.headers && req.headers.authorization);
  if (!token) {
    throw Object.assign(new Error("Sign in to tinker first."), { status: 401 });
  }
  if (token.startsWith("mcp_")) {
    throw Object.assign(
      new Error("Connector credentials cannot manage Notion OAuth."),
      { status: 401 },
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
  if (!userId) {
    throw Object.assign(new Error("Sign in to tinker first."), { status: 401 });
  }
  return userId;
}

module.exports = withResponseLogging(async function handler(req, res) {
  const q = queryParams(req);
  const action = String(q.action || "").trim().toLowerCase();

  try {
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.status(204).end();
      return;
    }

    if (req.method === "GET" && action === "callback") {
      try {
        if (q.error) {
          sendHtml(
            res,
            200,
            callbackPage({
              ok: false,
              message: String(q.error_description || q.error || "Notion denied access."),
            }),
          );
          return;
        }
        await store.completeConnect({ code: q.code, state: q.state });
        sendHtml(
          res,
          200,
          callbackPage({
            ok: true,
            message: "Connected. Returning to Connections…",
          }),
        );
      } catch (err) {
        sendHtml(
          res,
          err.status && err.status < 500 ? 200 : 502,
          callbackPage({
            ok: false,
            message: (err && err.message) || "Connection failed.",
          }),
        );
      }
      return;
    }

    if (req.method === "GET" && !action) {
      const userId = await requireSessionUser(req);
      const status = await store.getStatus({ userId });
      sendJson(res, 200, status);
      return;
    }

    if (req.method === "POST" && action === "connect") {
      const userId = await requireSessionUser(req);
      const result = await store.beginConnect({ userId });
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && action === "set-parent") {
      const userId = await requireSessionUser(req);
      const body = readBody(req);
      const status = await store.setParentPage({
        userId,
        parentPageId: body.parentPageId || body.pageId || body.url,
      });
      sendJson(res, 200, status);
      return;
    }

    if (req.method === "DELETE" && (action === "disconnect" || action === "")) {
      const userId = await requireSessionUser(req);
      const status = await store.disconnect({ userId });
      sendJson(res, 200, status);
      return;
    }

    if (req.method === "POST" && action === "disconnect") {
      const userId = await requireSessionUser(req);
      readBody(req);
      const status = await store.disconnect({ userId });
      sendJson(res, 200, status);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    sendJson(res, status, { error: (err && err.message) || "Error" });
  }
});
