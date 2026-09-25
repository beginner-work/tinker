/* GET /api/career
 * POST /api/career?action=extract
 * POST /api/career?action=fact
 *
 * Signed-in browser routes for the career record. The user id comes
 * from the Stytch session, never from the body or the URL. A bearer
 * that starts with mcp_ is rejected before Stytch. Bots read through
 * the connector tools, which cannot write.
 *
 * GET uses the read-only Redis token, then writes the seed once if
 * the user has no record yet. Extract and fact updates use the write
 * token. The uploaded file is not stored.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { withResponseLogging } = require("./_lib/log.js");
const { callerFromSession } = require("./_lib/autonomy.js");
const { UNAVAILABLE } = require("./_lib/career-redis.js");
const {
  ensureSeed,
  mutate,
  storeProposed,
  shapeForBrowser,
} = require("./_lib/career.js");
const { extractProposed } = require("./_lib/career-extract.js");

const NO_STORE = "no-store";

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
}

function actionFrom(req) {
  const query = req.query || {};
  if (typeof query.action === "string" && query.action) return query.action;
  try {
    const url = new URL(req.url || "/", "https://tinker.local");
    return url.searchParams.get("action") || "";
  } catch {
    return "";
  }
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
  if (token.startsWith("mcp_")) {
    throw Object.assign(
      new Error("Connector credentials cannot change the career record."),
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
  return callerFromSession(session);
}

function asUnavailable(err) {
  return err && err.status === 503;
}

async function getCareer(req, res) {
  const caller = await requireCaller(req);
  try {
    const record = await ensureSeed(caller.userId);
    sendJson(res, 200, shapeForBrowser(record), { "Cache-Control": NO_STORE });
  } catch (err) {
    if (asUnavailable(err)) {
      sendUnavailable(res);
      return;
    }
    throw err;
  }
}

async function postExtract(req, res) {
  const caller = await requireCaller(req);
  const body = readBody(req);
  const documents = Array.isArray(body.documents) ? body.documents : [];
  let facts;
  try {
    facts = await extractProposed(documents);
  } catch (err) {
    if (asUnavailable(err)) {
      sendUnavailable(res);
      return;
    }
    throw err;
  }
  try {
    const record = await storeProposed(caller.userId, facts);
    sendJson(res, 200, shapeForBrowser(record), { "Cache-Control": NO_STORE });
  } catch (err) {
    if (asUnavailable(err)) {
      sendUnavailable(res);
      return;
    }
    throw err;
  }
}

async function postFact(req, res) {
  const caller = await requireCaller(req);
  const body = readBody(req);
  try {
    const record = await mutate(caller.userId, body);
    sendJson(res, 200, shapeForBrowser(record), { "Cache-Control": NO_STORE });
  } catch (err) {
    if (asUnavailable(err)) {
      sendUnavailable(res);
      return;
    }
    throw err;
  }
}

module.exports = withResponseLogging(async function handler(req, res) {
  try {
    const action = actionFrom(req);
    if (req.method === "GET" && !action) {
      await getCareer(req, res);
      return;
    }
    if (req.method === "POST" && action === "extract") {
      await postExtract(req, res);
      return;
    }
    if (req.method === "POST" && action === "fact") {
      await postFact(req, res);
      return;
    }
    res.setHeader("Allow", "GET, POST");
    sendJson(res, 405, { error: "Method not allowed" }, { "Cache-Control": NO_STORE });
  } catch (err) {
    const fallback = req.method === "GET" ? "Could not load the career record." : "Could not save the career record.";
    sendError(res, err, fallback);
  }
});
