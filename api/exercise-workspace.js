/* GET/POST /api/exercise-workspace
 *
 * Per-owner exercise file trees seeded from tlindow/lindowlabs.
 * Mutations persist in TinkerUserData; GitHub is never written.
 *
 * GET  ?action=list|sync
 * POST ?action=create_node|rename_node|move_node|delete_node|write_file|reorder_exercises
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { withResponseLogging } = require("./_lib/log.js");
const store = require("./_lib/exercise-workspace-store.js");

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
    try { body = JSON.parse(body); }
    catch { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); }
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
  if (!token) throw Object.assign(new Error("Sign in to tinker first."), { status: 401 });
  if (token.startsWith("mcp_")) {
    throw Object.assign(new Error("Connector credentials cannot manage exercise workspace."), { status: 401 });
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
  return { userId };
}

async function dispatch(method, action, auth, body) {
  const { userId } = auth;
  if (method === "GET" && (action === "list" || action === "sync" || action === "")) {
    return { status: 200, body: await store.listWorkspace({ userId }) };
  }
  if (method === "POST" && action === "create_node") {
    return {
      status: 200,
      body: await store.createNode({
        userId,
        exerciseId: body.exerciseId,
        type: body.type,
        name: body.name,
        parentId: body.parentId,
        content: body.content,
      }),
    };
  }
  if (method === "POST" && action === "rename_node") {
    return {
      status: 200,
      body: await store.renameNode({
        userId,
        exerciseId: body.exerciseId,
        nodeId: body.nodeId || body.id,
        name: body.name,
      }),
    };
  }
  if (method === "POST" && action === "move_node") {
    return {
      status: 200,
      body: await store.moveNode({
        userId,
        exerciseId: body.exerciseId,
        nodeId: body.nodeId || body.id,
        parentId: body.parentId,
        beforeId: body.beforeId,
      }),
    };
  }
  if (method === "POST" && action === "delete_node") {
    return {
      status: 200,
      body: await store.deleteNode({
        userId,
        exerciseId: body.exerciseId,
        nodeId: body.nodeId || body.id,
        confirm: !!body.confirm,
      }),
    };
  }
  if (method === "POST" && action === "write_file") {
    return {
      status: 200,
      body: await store.writeFile({
        userId,
        exerciseId: body.exerciseId,
        nodeId: body.nodeId || body.id,
        content: body.content,
      }),
    };
  }
  if (method === "POST" && action === "reorder_exercises") {
    return {
      status: 200,
      body: await store.reorderExercises({
        userId,
        order: body.order,
      }),
    };
  }
  throw Object.assign(new Error("Unknown action."), { status: 404 });
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
  const action = queryValue(req, "action");
  let body = {};
  try {
    if (req.method === "POST") body = readBody(req);
  } catch (err) {
    send(res, err.status || 400, { error: err.message || "Bad request" });
    return;
  }
  try {
    const result = await dispatch(req.method, action, auth, body);
    send(res, result.status, result.body);
  } catch (err) {
    const status = err.status || 500;
    const payload = { error: err.message || "Server error" };
    if (err.code) payload.code = err.code;
    if (err.nodeCount != null) payload.nodeCount = err.nodeCount;
    send(res, status, payload);
  }
});
