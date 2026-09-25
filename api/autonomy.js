/* GET /api/autonomy
 * PUT /api/autonomy/:key
 *
 * One function. vercel.json rewrites /api/autonomy/:key onto this file
 * with ?key=. GET is public and read-only. PUT checks the Stytch
 * session, then AUTONOMY_ALLOWLIST. There is no auth middleware on GET.
 *
 * A missing table, a missing row, or any read error is not autonomous.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const prisma = require("./_lib/db.js");
const { withResponseLogging } = require("./_lib/log.js");
const {
  itemFor,
  shapeItem,
  shapeList,
  closedList,
  editorFromSession,
  parseNote,
} = require("./_lib/autonomy.js");

const CACHE_CONTROL = "public, max-age=60";

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
}

function keyFrom(req) {
  const query = req.query || {};
  if (typeof query.key === "string" && query.key) return query.key;
  try {
    const url = new URL(req.url || "/", "https://tinker.local");
    const fromQuery = url.searchParams.get("key");
    if (fromQuery) return fromQuery;
    const parts = url.pathname.split("/").filter(Boolean);
    const at = parts.lastIndexOf("autonomy");
    if (at >= 0 && parts[at + 1]) return decodeURIComponent(parts[at + 1]);
  } catch {
    /* ignore a malformed URL */
  }
  return "";
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

function sendJson(res, status, body, headers) {
  if (headers) {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  }
  res.status(status).json(body);
}

function sendError(res, err, fallback) {
  const status = err.status || 500;
  const message = status >= 500 ? fallback : err.message || fallback;
  sendJson(res, status, { error: message }, { "Cache-Control": "no-store" });
}

async function requireEditor(req) {
  const token = extractBearer(req.headers && req.headers.authorization);
  if (!token) {
    throw Object.assign(new Error("Sign in to tinker first."), { status: 401 });
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
  return editorFromSession(session);
}

function tableMissing(err) {
  if (!err) return false;
  if (err.code === "P2021") return true;
  if (err.meta && err.meta.code === "42P01") return true;
  const message = String(err.message || "");
  return /does not exist/i.test(message) && /autonomy_settings|AutonomySetting/.test(message);
}

async function listAutonomy(res) {
  let rows;
  try {
    rows = await prisma.autonomySetting.findMany();
  } catch {
    sendJson(res, 200, closedList(), { "Cache-Control": CACHE_CONTROL });
    return;
  }
  sendJson(res, 200, shapeList(rows), { "Cache-Control": CACHE_CONTROL });
}

async function updateAutonomy(req, res) {
  const key = keyFrom(req);
  const def = itemFor(key);
  if (!def) {
    sendJson(res, 404, { error: "Unknown autonomy setting." }, { "Cache-Control": "no-store" });
    return;
  }

  const editor = await requireEditor(req);
  const body = readBody(req);
  const hasAutonomous = body && Object.prototype.hasOwnProperty.call(body, "autonomous");
  const hasNote = body && Object.prototype.hasOwnProperty.call(body, "note");
  if (!hasAutonomous && !hasNote) {
    sendJson(
      res,
      400,
      { error: "Body must include autonomous, note, or both." },
      { "Cache-Control": "no-store" },
    );
    return;
  }
  if (hasAutonomous && typeof body.autonomous !== "boolean") {
    sendJson(
      res,
      400,
      { error: "autonomous must be true or false." },
      { "Cache-Control": "no-store" },
    );
    return;
  }

  const data = {
    updatedBy: editor.updatedBy,
    updatedAt: new Date(),
  };
  if (hasAutonomous) data.autonomous = body.autonomous;
  if (hasNote) data.note = parseNote(body.note);

  let saved;
  try {
    saved = await prisma.autonomySetting.update({ where: { key }, data });
  } catch (err) {
    if (err && (err.code === "P2025" || tableMissing(err))) {
      sendJson(
        res,
        503,
        { error: "Autonomy settings are not ready." },
        { "Cache-Control": "no-store" },
      );
      return;
    }
    throw err;
  }

  sendJson(res, 200, shapeItem(def, saved), { "Cache-Control": "no-store" });
}

module.exports = withResponseLogging(async function handler(req, res) {
  try {
    if (req.method === "GET") {
      await listAutonomy(res);
      return;
    }
    if (req.method === "PUT") {
      await updateAutonomy(req, res);
      return;
    }
    res.setHeader("Allow", "GET, PUT");
    sendJson(res, 405, { error: "Method not allowed" }, { "Cache-Control": "no-store" });
  } catch (err) {
    sendError(res, err, req.method === "PUT" ? "Could not save autonomy." : "Could not load autonomy.");
  }
});
