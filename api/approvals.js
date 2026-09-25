/* GET /api/approvals
 * PUT /api/approvals/:key
 *
 * One function. vercel.json rewrites /api/approvals/:key onto this
 * file with ?key=. GET is public and read-only. PUT checks the Stytch
 * session, then APPROVAL_ALLOWLIST. There is no auth middleware on GET.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const prisma = require("./_lib/db.js");
const { withResponseLogging } = require("./_lib/log.js");
const { itemFor, shapeItem, shapeList, editorFromSession } = require("./_lib/approvals.js");

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
    const approvalsAt = parts.lastIndexOf("approvals");
    if (approvalsAt >= 0 && parts[approvalsAt + 1]) {
      return decodeURIComponent(parts[approvalsAt + 1]);
    }
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
  return /does not exist/i.test(message) && /approval_settings|ApprovalSetting/.test(message);
}

async function listApprovals(res) {
  let rows = [];
  try {
    rows = await prisma.approvalSetting.findMany();
  } catch (err) {
    // Migrate does not run on the Vercel build. Until the table exists,
    // bots still get the catalog defaults (same booleans as the seed).
    if (!tableMissing(err)) throw err;
  }
  sendJson(res, 200, shapeList(rows), { "Cache-Control": CACHE_CONTROL });
}

async function updateApproval(req, res) {
  const key = keyFrom(req);
  const def = itemFor(key);
  if (!def) {
    sendJson(res, 404, { error: "Unknown approval." }, { "Cache-Control": "no-store" });
    return;
  }

  const editor = await requireEditor(req);
  const body = readBody(req);
  if (!body || typeof body.required !== "boolean") {
    sendJson(
      res,
      400,
      { error: "Body must be {\"required\": true or false}." },
      { "Cache-Control": "no-store" },
    );
    return;
  }

  let saved;
  try {
    saved = await prisma.approvalSetting.update({
      where: { key },
      data: {
        required: body.required,
        updatedBy: editor.updatedBy,
        updatedAt: new Date(),
      },
    });
  } catch (err) {
    if (err && (err.code === "P2025" || tableMissing(err))) {
      throw Object.assign(new Error("Approval settings are not ready."), { status: 503 });
    }
    throw err;
  }

  sendJson(res, 200, shapeItem(def, saved), { "Cache-Control": "no-store" });
}

module.exports = withResponseLogging(async function handler(req, res) {
  try {
    if (req.method === "GET") {
      await listApprovals(res);
      return;
    }
    if (req.method === "PUT") {
      await updateApproval(req, res);
      return;
    }
    res.setHeader("Allow", "GET, PUT");
    sendJson(res, 405, { error: "Method not allowed" }, { "Cache-Control": "no-store" });
  } catch (err) {
    sendError(res, err, req.method === "PUT" ? "Could not save approval." : "Could not load approvals.");
  }
});
