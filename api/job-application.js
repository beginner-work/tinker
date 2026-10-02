/* GET/POST /api/job-application
 *
 * Owner route for job application inbox items. MCP bots create/update via
 * create_application / update_application / list_applications /
 * mark_application_done on /api/mcp.
 *
 * GET  ?action=list → { applications }
 * GET  ?action=get&id= → { application }
 * POST ?action=create body { roleTitle, companyName, ... } → { application }
 * POST ?action=update body { ... } &id= → { application }
 * POST ?action=done &id= → { application, recruiterTouches }
 * POST ?action=edit body { fitNotes } &id= → { application }
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { withResponseLogging } = require("./_lib/log.js");
const store = require("./_lib/job-application-store.js");

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
  if (token.startsWith("mcp_")) {
    throw Object.assign(new Error("Connector credentials use application tools on /api/mcp."), { status: 401 });
  }
  let session;
  try { session = await authenticateSession(token); }
  catch (err) {
    if (err.status && err.status >= 400 && err.status < 500) {
      throw Object.assign(new Error("Session expired."), { status: 401 });
    }
    throw err;
  }
  const userId = userIdFromSession(session);
  if (!userId) throw Object.assign(new Error("Session missing user id."), { status: 401 });
  const emailHint = session && (session.email || (session.user && session.user.emails && session.user.emails[0] && session.user.emails[0].email)) || "";
  return { userId, emailHint };
}

async function dispatch(method, action, auth, body, id) {
  const { userId, emailHint } = auth;
  if (method === "GET" && (action === "list" || action === "")) {
    return {
      status: 200,
      body: { applications: await store.listApplications({ userId, status: queryValue({ query: body }, "status") || body.status }) },
    };
  }
  if (method === "GET" && action === "get") {
    return { status: 200, body: { application: await store.getApplication({ userId, applicationId: id }) } };
  }
  if (method === "POST" && action === "create") {
    return {
      status: 201,
      body: { application: await store.createApplication(Object.assign({}, body, { userId })) },
    };
  }
  if (method === "POST" && action === "update") {
    return {
      status: 200,
      body: { application: await store.updateApplication({ userId, applicationId: id, patch: body }) },
    };
  }
  if (method === "POST" && action === "edit") {
    return {
      status: 200,
      body: {
        application: await store.updateApplication({
          userId,
          applicationId: id,
          patch: { fitNotes: body.fitNotes },
        }),
      },
    };
  }
  if (method === "POST" && action === "done") {
    const result = await store.markApplicationDone({
      userId,
      emailHint,
      applicationId: id,
      actor: { kind: "owner", label: "owner" },
    });
    return { status: 200, body: result };
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
  try { auth = await resolve(req); }
  catch (err) { send(res, err.status || 401, { error: err.message || "Unauthorized" }); return; }
  try {
    const body = req.method === "GET" ? {} : readBody(req);
    const action = queryValue(req, "action") || (typeof body.action === "string" ? body.action : "");
    const id = queryValue(req, "id") || body.id || "";
    // For list, pass query status through body helper awkwardly — read from req.
    if (req.method === "GET" && (action === "list" || action === "")) {
      const status = queryValue(req, "status");
      const stage = queryValue(req, "stage");
      send(res, 200, {
        applications: await store.listApplications({
          userId: auth.userId,
          status: status || undefined,
          stage: stage || undefined,
        }),
      });
      return;
    }
    const out = await dispatch(req.method, action, auth, body, id);
    send(res, out.status, out.body);
  } catch (err) {
    const status = err.status || 500;
    send(res, status, { error: status >= 500 ? store.UNAVAILABLE : err.message || "Bad request" });
  }
});
