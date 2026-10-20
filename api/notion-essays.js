/* POST /api/notion-essays
 *
 * Write a finished essay into the user's Notion Essays database.
 * Creates the database under the chosen parent page when missing.
 *
 * Body: { title, body, date?, learningGoal?, exercise? }
 * Auth: Stytch session bearer (not mcp_).
 *
 * Optional one-time export:
 *   POST /api/notion-essays?action=export-founder-source
 *   Body: { dryRun?: boolean }
 *   Copies every Founder Source essay into the Essays database,
 *   skipping rows already present (by Tinker id or title).
 *
 * Fire-and-forget from /repo after This is everything. Missing Notion
 * connection returns 400 with code notion_not_connected (client ignores —
 * Notion is optional). Missing parent page returns notion_parent_required;
 * the writing app surfaces that so silent failures are not mistaken for
 * a successful Notion save.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { withResponseLogging } = require("./_lib/log.js");
const notionApi = require("./_lib/notion-api.js");
const notionExport = require("./_lib/notion-essays-export.js");

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

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

async function resolveUser(req) {
  const token = bearer(req.headers && req.headers.authorization);
  if (!token) {
    throw Object.assign(new Error("Sign in to tinker first."), { status: 401 });
  }
  if (token.startsWith("mcp_")) {
    throw Object.assign(
      new Error("Connector credentials cannot write Notion essays from this route."),
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
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    send(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const userId = await resolveUser(req);
    const q = queryParams(req);
    const action = String(q.action || "").trim().toLowerCase();
    const body = readBody(req);

    if (action === "export-founder-source") {
      const dryRun = !!(body.dryRun || body.dry_run || q.dryRun === "1");
      const result = await notionExport.exportFounderSourceEssays({
        userId,
        dryRun,
      });
      send(res, 200, { ok: true, export: result });
      return;
    }

    const result = await notionApi.writeEssay({
      userId,
      title: body.title,
      body: body.body,
      date: body.date || body.createdAt || body.updatedAt,
      learningGoal: body.learningGoal || body.goal || "",
      exercise: body.exercise || body.exerciseId || body.exerciseName || "",
    });
    send(res, 200, { ok: true, page: result });
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    send(res, status, {
      error: (err && err.message) || "Error",
      code: (err && err.code) || undefined,
    });
  }
});
