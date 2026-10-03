/* GET/POST /api/repo-folders
 *
 * Owner route for the /repo file-list folder tree (nested folders + file
 * placements + content types). MCP is not involved.
 *
 * GET  ?action=list → { folders, placements, fileTypes, contentTypes, ... }
 * POST ?action=create_folder body { name, parentId?, contentType? }
 * POST ?action=rename_folder body { id, name }
 * POST ?action=move_folder body { id, parentId }
 * POST ?action=delete_folder body { id, confirm?, deleteContents? }
 * POST ?action=move_file body { fileId, folderId|null }
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { withResponseLogging } = require("./_lib/log.js");
const store = require("./_lib/repo-folders-store.js");

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
    throw Object.assign(new Error("Connector credentials cannot manage repo folders."), { status: 401 });
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
  if (method === "GET" && (action === "list" || action === "")) {
    return { status: 200, body: await store.getTree({ userId }) };
  }
  if (method === "POST" && action === "create_folder") {
    return {
      status: 200,
      body: await store.createFolder({
        userId,
        name: body.name,
        parentId: body.parentId,
        contentType: body.contentType,
      }),
    };
  }
  if (method === "POST" && action === "rename_folder") {
    return {
      status: 200,
      body: await store.renameFolder({
        userId,
        folderId: body.id || body.folderId,
        name: body.name,
      }),
    };
  }
  if (method === "POST" && action === "move_folder") {
    return {
      status: 200,
      body: await store.moveFolder({
        userId,
        folderId: body.id || body.folderId,
        parentId: body.parentId,
      }),
    };
  }
  if (method === "POST" && action === "delete_folder") {
    return {
      status: 200,
      body: await store.deleteFolder({
        userId,
        folderId: body.id || body.folderId,
        confirm: !!body.confirm,
        deleteContents: !!body.deleteContents,
      }),
    };
  }
  if (method === "POST" && action === "move_file") {
    return {
      status: 200,
      body: await store.moveFile({
        userId,
        fileId: body.fileId || body.id,
        folderId: Object.prototype.hasOwnProperty.call(body, "folderId") ? body.folderId : null,
      }),
    };
  }
  return { status: 404, body: { error: "Unknown action." } };
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
  const action = queryValue(req, "action") || (req.method === "GET" ? "list" : "");
  let body = {};
  try {
    if (req.method === "POST") body = readBody(req);
  } catch (err) {
    send(res, err.status || 400, { error: err.message || "Bad request" });
    return;
  }
  try {
    const result = await dispatch(req.method, action, auth, body);
    if (result.status >= 400 && result.body && result.body.error) {
      send(res, result.status, result.body);
      return;
    }
    send(res, result.status, result.body);
  } catch (err) {
    const payload = { error: err.message || store.UNAVAILABLE };
    if (err.code) payload.code = err.code;
    if (err.fileCount != null) payload.fileCount = err.fileCount;
    if (err.folderCount != null) payload.folderCount = err.folderCount;
    send(res, err.status || 500, payload);
  }
});
