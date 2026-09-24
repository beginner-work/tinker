/* GET/POST/PATCH /api/linkedin-drafts
 *
 * Session auth, same Stytch check as the writing app. Rows are limited
 * to that user id. GET lists, with optional kind and status filters.
 * POST creates a draft. PATCH edits body, notes, kind, status, and
 * scheduledAt. A time can be stored only after approve. Posted is set
 * by hand. This does not post to LinkedIn.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { withResponseLogging } = require("./_lib/log.js");
const store = require("./_lib/linkedin-drafts-store.js");

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
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

function jsonBody(req) {
  const body = req.body;
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) return body;
  const raw = Buffer.isBuffer(body) ? body.toString("utf8") : typeof body === "string" ? body : "";
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw Object.assign(new Error("Invalid JSON"), { status: 400 });
    }
    return parsed;
  } catch (err) {
    if (err && err.status) throw err;
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

function present(row) {
  return {
    id: row.id,
    body: row.body,
    notes: row.notes || "",
    kind: row.kind,
    status: row.status,
    scheduledAt: row.scheduledAt ? new Date(row.scheduledAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

async function resolveUserId(req) {
  const session = await authenticateSession(extractBearer(req.headers && req.headers.authorization));
  const userId = userIdFromSession(session);
  if (!userId) throw Object.assign(new Error("Session missing user id."), { status: 401 });
  return userId;
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST" && req.method !== "PATCH") {
    res.setHeader("Allow", "GET, POST, PATCH");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let userId;
  try {
    userId = await resolveUserId(req);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  try {
    if (req.method === "GET") {
      const drafts = await store.listDrafts({
        userId,
        kind: queryValue(req, "kind"),
        status: queryValue(req, "status"),
      });
      res.status(200).json({ drafts: drafts.map(present) });
      return;
    }

    const body = jsonBody(req);
    if (req.method === "POST") {
      const row = await store.createDraft({
        userId,
        body: body.body,
        notes: body.notes,
        kind: body.kind,
      });
      res.status(201).json({ draft: present(row) });
      return;
    }

    const patch = {};
    for (const key of ["body", "notes", "kind", "status", "scheduledAt"]) {
      if (Object.prototype.hasOwnProperty.call(body, key)) patch[key] = body[key];
    }
    const row = await store.patchDraft({ id: body.id, userId, patch });
    res.status(200).json({ draft: present(row) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
});
