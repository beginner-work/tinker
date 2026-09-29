"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { sessionIdentity } = require("./_lib/autonomy.js");
const { withResponseLogging } = require("./_lib/log.js");
const store = require("./_lib/selling-parts-store.js");

function bearer(header) {
  const match = header && String(header).match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : "";
}
function queryValue(req, key) {
  const fromQuery = req.query && req.query[key];
  const value = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
  if (value != null && value !== "") return String(value);
  try { return new URL(req.url || "/", "http://localhost").searchParams.get(key) || ""; }
  catch { return ""; }
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
  if (token.startsWith("mcp_")) throw Object.assign(new Error("Connector credentials cannot use selling parts."), { status: 401 });
  let session;
  try { session = await authenticateSession(token); }
  catch (err) {
    if (err.status && err.status >= 400 && err.status < 500) throw Object.assign(new Error("Session expired."), { status: 401 });
    throw err;
  }
  const userId = userIdFromSession(session);
  if (!userId) throw Object.assign(new Error("Session missing user id."), { status: 401 });
  const who = (sessionIdentity(session).emails[0] || userId).slice(0, 180);
  return { userId, actor: { kind: "human", label: "tyler:" + who } };
}
async function dispatch(method, action, auth, body, req) {
  const { userId, actor } = auth;
  const id = (typeof body.id === "string" && body.id.trim()) || queryValue(req, "id");
  if (method === "GET" && action === "stages") return { status: 200, body: { stages: await store.getStages({ userId }) } };
  if (method === "POST" && action === "stages") {
    return { status: 200, body: { stages: await store.updateStages({ userId, stages: body.stages }) } };
  }
  if (method === "GET" && (action === "list" || action === "")) {
    const parts = await store.listParts({
      userId, stage: queryValue(req, "stage"), topic: queryValue(req, "topic"), status: queryValue(req, "status"),
      sourceKind: queryValue(req, "sourceKind"), stack: queryValue(req, "stack"),
    });
    return { status: 200, body: { parts: parts.map(store.presentPart) } };
  }
  if (method === "GET" && action === "part") {
    return { status: 200, body: { part: store.presentPart(await store.getPart({ id, userId })) } };
  }
  if (method === "POST" && action === "create") {
    const result = await store.createPart(Object.assign({ userId, actor }, body));
    return { status: result.created ? 201 : 200, body: { created: result.created, part: store.presentPart(result.row) } };
  }
  if (method === "PATCH" && (action === "edit" || action === "")) {
    return { status: 200, body: { part: store.presentPart(await store.updatePart({ id, userId, actor, patch: body })) } };
  }
  if (method === "POST" && action === "status") {
    const result = await store.setStatus({ id, userId, actor, status: body.status });
    return { status: 200, body: { part: store.presentPart(result.part), event: store.presentEvent(result.event) } };
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
  try { auth = await resolve(req); }
  catch (err) { send(res, err.status || 401, { error: err.message || "Unauthorized" }); return; }
  try {
    const body = method === "GET" ? {} : readBody(req);
    const action = queryValue(req, "action") || (typeof body.action === "string" ? body.action : "");
    const out = await dispatch(method, action, auth, body, req);
    send(res, out.status, out.body);
  } catch (err) {
    const status = err.status || 500;
    send(res, status, { error: status >= 500 ? store.UNAVAILABLE : err.message || "Bad request" });
  }
});
