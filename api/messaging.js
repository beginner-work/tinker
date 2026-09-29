/* Owner messaging routes. Stytch session only; mcp_ bearers are rejected.
 * GET contacts|contact|threads|thread|draft.
 * POST contact|thread|draft|submit|approve|cancel. PATCH draft. Does not send.
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { sessionIdentity } = require("./_lib/autonomy.js");
const { withResponseLogging } = require("./_lib/log.js");
const store = require("./_lib/messaging-store.js");

const MOVE = { submit: "pending_approval", approve: "approved", cancel: "canceled" };

function bearer(header) {
  const match = header && String(header).match(/^Bearer\s+(\S+)$/i);
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
    try { body = JSON.parse(body); } catch { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); }
  }
  if (body == null) return {};
  if (typeof body !== "object" || Array.isArray(body)) throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  return body;
}

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json(body);
}

async function resolve(req) {
  const token = bearer(req.headers && req.headers.authorization);
  if (!token) throw Object.assign(new Error("Sign in to tinker first."), { status: 401 });
  if (token.startsWith("mcp_")) throw Object.assign(new Error("Connector credentials cannot use messaging."), { status: 401 });
  let session;
  try {
    session = await authenticateSession(token);
  } catch (err) {
    if (err.status && err.status >= 400 && err.status < 500) throw Object.assign(new Error("Session expired."), { status: 401 });
    throw err;
  }
  const userId = userIdFromSession(session);
  if (!userId) throw Object.assign(new Error("Session missing user id."), { status: 401 });
  const who = (sessionIdentity(session).emails[0] || userId).slice(0, 180);
  return { userId, actor: { kind: "human", label: "tyler:" + who } };
}

async function dispatch(method, action, auth, body, id) {
  const { userId, actor } = auth;
  if (method === "GET" && action === "contacts") {
    return { status: 200, body: { contacts: (await store.listContacts({ userId })).map(store.presentContact) } };
  }
  if (method === "GET" && action === "contact") {
    return { status: 200, body: { contact: store.presentContact(await store.getContact({ id, userId })) } };
  }
  if (method === "GET" && action === "threads") {
    return { status: 200, body: { threads: (await store.listThreads({ userId })).map(store.presentThread) } };
  }
  if (method === "GET" && action === "thread") return { status: 200, body: store.presentDetail(await store.getThread({ id, userId })) };
  if (method === "GET" && action === "draft") {
    return { status: 200, body: { message: store.presentMessage(await store.getMessage({ id, userId })) } };
  }
  if (method === "POST" && action === "contact") {
    const result = await store.createContact(Object.assign({ userId, actor }, body));
    return { status: result.created ? 201 : 200, body: { created: result.created, contact: store.presentContact(result.row) } };
  }
  if (method === "POST" && action === "thread") {
    const result = await store.createThread(Object.assign({ userId, actor }, body));
    return { status: 201, body: { created: true, thread: store.presentThread(result.row) } };
  }
  if (method === "POST" && action === "draft") {
    const result = await store.createDraft(Object.assign({ userId, actor }, body));
    return { status: result.created ? 201 : 200, body: { created: result.created, message: store.presentMessage(result.row) } };
  }
  if (method === "POST" && MOVE[action]) {
    const result = await store.transition({ id, userId, to: MOVE[action], actor });
    return { status: 200, body: { message: store.presentMessage(result.message), event: store.presentEvent(result.event) } };
  }
  if (method === "PATCH" && (action === "draft" || action === "")) {
    return { status: 200, body: { message: store.presentMessage(await store.updateDraft({ id, userId, actor, patch: body })) } };
  }
  throw Object.assign(new Error(action ? "Unknown action." : "Action is required."), { status: 400 });
}

module.exports = withResponseLogging(async function handler(req, res) {
  const method = req.method || "GET";
  if (method !== "GET" && method !== "POST" && method !== "PATCH") {
    res.setHeader("Allow", "GET, POST, PATCH");
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
  try {
    const body = method === "GET" ? {} : readBody(req);
    const action = queryValue(req, "action") || (typeof body.action === "string" ? body.action : "");
    const id = (typeof body.id === "string" && body.id.trim()) || queryValue(req, "id");
    const out = await dispatch(method, action, auth, body, id);
    send(res, out.status, out.body);
  } catch (err) {
    const status = err.status || 500;
    send(res, status, { error: status >= 500 ? store.UNAVAILABLE : err.message || "Bad request" });
  }
});
