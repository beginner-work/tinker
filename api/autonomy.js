/* GET /api/autonomy
 * PUT /api/autonomy/:key
 *
 * One function. vercel.json rewrites /api/autonomy/:key onto this file
 * with ?key=. Both methods require the caller's verified Stytch
 * session. Settings are that user's Redis hash only. The user id
 * never comes from the body or the URL.
 *
 * A missing hash, a missing field, a bad value, or any store error
 * reads as not autonomous. GET uses the read-only Redis token and
 * does not fall back to the write token. GET is not cached. A store
 * error on PUT saves nothing.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { withResponseLogging } = require("./_lib/log.js");
const {
  itemFor,
  shapeItem,
  shapeList,
  closedList,
  callerFromSession,
  parseNote,
} = require("./_lib/autonomy.js");
const { UNAVAILABLE, readAll, readField, writeField } = require("./_lib/autonomy-redis.js");

const NO_STORE = "no-store";

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
  sendJson(res, status, { error: message }, { "Cache-Control": NO_STORE });
}

function sendUnavailable(res) {
  sendJson(res, 503, { error: UNAVAILABLE }, { "Cache-Control": NO_STORE });
}

async function requireCaller(req) {
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
  return callerFromSession(session);
}

async function listAutonomy(req, res) {
  const caller = await requireCaller(req);
  try {
    const rows = await readAll(caller.userId);
    const list = [];
    for (const [key, row] of rows) list.push({ key, ...row });
    sendJson(res, 200, shapeList(list), { "Cache-Control": NO_STORE });
  } catch {
    sendJson(res, 200, closedList(), { "Cache-Control": NO_STORE });
  }
}

async function updateAutonomy(req, res) {
  const caller = await requireCaller(req);
  const key = keyFrom(req);
  const def = itemFor(key);
  if (!def) {
    sendJson(res, 404, { error: "Unknown autonomy setting." }, { "Cache-Control": NO_STORE });
    return;
  }

  const body = readBody(req);
  const hasAutonomous = body && Object.prototype.hasOwnProperty.call(body, "autonomous");
  const hasNote = body && Object.prototype.hasOwnProperty.call(body, "note");
  if (!hasAutonomous && !hasNote) {
    sendJson(
      res,
      400,
      { error: "Body must include autonomous, note, or both." },
      { "Cache-Control": NO_STORE },
    );
    return;
  }
  if (hasAutonomous && typeof body.autonomous !== "boolean") {
    sendJson(
      res,
      400,
      { error: "autonomous must be true or false." },
      { "Cache-Control": NO_STORE },
    );
    return;
  }

  let note;
  if (hasNote) note = parseNote(body.note);

  let current;
  try {
    current = await readField(caller.userId, key);
  } catch (err) {
    if (err && err.status === 503) {
      sendUnavailable(res);
      return;
    }
    throw err;
  }

  const written = {
    autonomous: hasAutonomous ? body.autonomous : current.autonomous,
    note: hasNote ? note || "" : current.note,
    updated_by: caller.updatedBy,
    updated_at: new Date().toISOString(),
  };
  try {
    await writeField(caller.userId, key, written);
  } catch (err) {
    if (err && err.status === 503) {
      sendUnavailable(res);
      return;
    }
    throw err;
  }

  sendJson(res, 200, shapeItem(def, {
    autonomous: written.autonomous,
    note: written.note,
    updatedBy: written.updated_by,
    updatedAt: written.updated_at,
  }), { "Cache-Control": NO_STORE });
}

module.exports = withResponseLogging(async function handler(req, res) {
  try {
    if (req.method === "GET") {
      await listAutonomy(req, res);
      return;
    }
    if (req.method === "PUT") {
      await updateAutonomy(req, res);
      return;
    }
    res.setHeader("Allow", "GET, PUT");
    sendJson(res, 405, { error: "Method not allowed" }, { "Cache-Control": NO_STORE });
  } catch (err) {
    sendError(res, err, req.method === "PUT" ? "Could not save autonomy." : "Could not load autonomy.");
  }
});
