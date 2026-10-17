/* /api/mcp-context — Notion context pages (business / technical goals).
 *
 * GET  ?action=list|status
 * POST { action: search|select|clear, ... }
 * Read-only MCP tools only (notion-search / notion-fetch).
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { withResponseLogging } = require("./_lib/log.js");
const pages = require("./_lib/mcp-context-pages.js");

function bearer(header) {
  const match = header && String(header).match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
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

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

async function resolve(req) {
  const token = bearer(req.headers && req.headers.authorization);
  if (!token) {
    throw Object.assign(new Error("Sign in to tinker first."), { status: 401 });
  }
  if (token.startsWith("mcp_")) {
    throw Object.assign(
      new Error("Connector credentials cannot manage MCP context."),
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
  if (!userId) {
    throw Object.assign(new Error("Session missing user id."), { status: 401 });
  }
  return { userId };
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
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
  let body = {};
  try {
    if (req.method === "POST") body = readBody(req);
  } catch (err) {
    send(res, err.status || 400, { error: err.message || "Bad request" });
    return;
  }
  const q = req.query || {};
  const action =
    (body && body.action) ||
    q.action ||
    (req.method === "GET" ? "list" : "");
  try {
    if (action === "list" || action === "status") {
      const ctx = await pages.readContext(auth.userId);
      const prompts = await pages.contextForPrompts(auth.userId);
      send(res, 200, {
        context: ctx,
        businessContext: prompts.businessContext,
        technicalGoalsContext: prompts.technicalGoalsContext,
      });
      return;
    }
    if (action === "search") {
      const result = await pages.searchPages({
        userId: auth.userId,
        query: body.query || body.q || q.q,
      });
      send(res, 200, result);
      return;
    }
    if (action === "select") {
      const ctx = await pages.selectPage({
        userId: auth.userId,
        role: body.role,
        pageId: body.pageId || body.id,
        title: body.title,
        snippet: body.snippet,
        url: body.url,
      });
      send(res, 200, { context: ctx });
      return;
    }
    if (action === "clear") {
      const ctx = await pages.clearRole({
        userId: auth.userId,
        role: body.role || q.role,
      });
      send(res, 200, { context: ctx });
      return;
    }
    send(res, 400, { error: "Unknown action." });
  } catch (err) {
    send(res, err.status || 500, {
      error: err.message || "Server error",
      code: err.code || undefined,
    });
  }
});
