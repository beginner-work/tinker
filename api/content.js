/* GET /api/content
 * POST /api/content
 * PATCH /api/content
 *
 * Owner routes for site content. The user id comes from the Stytch
 * session, never from the body or the URL. A bearer that starts with
 * mcp_ is rejected before Stytch. Bots list, read, and draft through
 * the connector tools. They cannot publish.
 *
 * GET lists this user's items, or one item when ?id= is set. Someone
 * else's id is 404. POST creates a draft, or publishes when status is
 * published. The same draftKey or site slug returns the existing row.
 * POST { action: "import", publish } copies the dreamingwithmarisol.com
 * seed onto this user. PATCH edits one owned item, including status.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { withResponseLogging } = require("./_lib/log.js");
const store = require("./_lib/content-store.js");

const NO_STORE = "no-store";

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
  res.setHeader("Cache-Control", NO_STORE);
  res.status(status).json(body);
}

async function resolveUserId(req) {
  const token = extractBearer(req.headers && req.headers.authorization);
  if (!token) throw Object.assign(new Error("Sign in to tinker first."), { status: 401 });
  if (token.startsWith("mcp_")) {
    throw Object.assign(new Error("Connector credentials cannot change content."), { status: 401 });
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
  return userId;
}

function idFrom(req, body) {
  if (body && typeof body.id === "string" && body.id.trim()) return body.id.trim();
  return queryValue(req, "id");
}

function hostName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}

module.exports = withResponseLogging(async function handler(req, res) {
  const method = req.method || "GET";
  if (method !== "GET" && method !== "POST" && method !== "PATCH") {
    res.setHeader("Allow", "GET, POST, PATCH");
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let userId;
  try {
    userId = await resolveUserId(req);
  } catch (err) {
    sendJson(res, err.status || 401, { error: err.message || "Unauthorized" });
    return;
  }

  try {
    if (method === "GET") {
      const id = queryValue(req, "id");
      if (id) {
        const row = await store.getContent({ id, userId });
        sendJson(res, 200, { item: store.presentOwner(row) });
        return;
      }
      const items = await store.listContent({
        userId,
        site: queryValue(req, "site"),
        type: queryValue(req, "type"),
        status: queryValue(req, "status"),
      });
      sendJson(res, 200, { items: items.map(store.presentOwner) });
      return;
    }

    const body = readBody(req);
    if (method === "POST" && body.action === "import") {
      if (body.site != null && body.site !== "" && hostName(body.site) !== store.MARISOL_SITE) {
        sendJson(res, 400, { error: "Only dreamingwithmarisol.com can be imported." });
        return;
      }
      const saved = await store.importMarisol({ userId, publish: body.publish === true });
      sendJson(res, 200, {
        site: store.MARISOL_SITE,
        created: saved.filter((entry) => entry.created).length,
        items: saved.map((entry) => store.presentOwner(entry.row)),
      });
      return;
    }

    if (method === "POST" && (body.action === "publish" || body.action === "unpublish")) {
      const row = await store.updateContent({
        id: idFrom(req, body),
        userId,
        patch: { status: body.action === "publish" ? "published" : "draft" },
        allowPublish: true,
      });
      sendJson(res, 200, { item: store.presentOwner(row) });
      return;
    }

    if (method === "POST" && body.action) {
      sendJson(res, 400, { error: "Unknown action." });
      return;
    }

    if (method === "POST") {
      const result = await store.createContent({
        userId,
        site: body.site,
        type: body.type,
        slug: body.slug,
        title: body.title,
        body: body.body,
        fields: body.fields,
        noteId: body.noteId,
        draftKey: body.draftKey,
        status: body.status,
        allowPublish: true,
      });
      sendJson(res, result.created ? 201 : 200, {
        created: result.created,
        item: store.presentOwner(result.row),
      });
      return;
    }

    const row = await store.updateContent({
      id: idFrom(req, body),
      userId,
      patch: body,
      allowPublish: true,
    });
    sendJson(res, 200, { item: store.presentOwner(row) });
  } catch (err) {
    const status = err.status || 500;
    const message = status >= 500 ? store.UNAVAILABLE : err.message || "Bad request";
    sendJson(res, status, { error: message });
  }
});
