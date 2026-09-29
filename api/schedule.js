/* Outreach schedule HTTP API. Owner-scoped. Tinker never sends. */
"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { sessionIdentity } = require("./_lib/autonomy.js");
const { withResponseLogging } = require("./_lib/log.js");
const leads = require("./_lib/leads-store.js");
const store = require("./_lib/outreach-schedule-store.js");

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
  if (token.startsWith("mcp_")) throw Object.assign(new Error("Connector credentials cannot use schedule."), { status: 401 });
  let session;
  try { session = await authenticateSession(token); }
  catch (err) {
    if (err.status && err.status >= 400 && err.status < 500) throw Object.assign(new Error("Session expired."), { status: 401 });
    throw err;
  }
  const userId = userIdFromSession(session);
  if (!userId) throw Object.assign(new Error("Session missing user id."), { status: 401 });
  const email = (sessionIdentity(session).emails[0] || "").slice(0, 180);
  leads.assertAllowed(userId, email);
  return { userId, emailHint: email, actor: { kind: "human", label: "user:" + (email || userId) } };
}
async function dispatch(method, action, auth, body, req) {
  const { userId, emailHint, actor } = auth;
  const id = (typeof body.id === "string" && body.id.trim()) || queryValue(req, "id");
  const base = { userId, emailHint, actor };
  if (method === "GET" && (action === "week" || action === "" || action === "schedule")) {
    return {
      status: 200,
      body: await store.getWeekSchedule({
        userId, emailHint,
        weekStart: queryValue(req, "weekStart") || body.weekStart,
        companyId: queryValue(req, "companyId") || body.companyId,
        touchType: queryValue(req, "touchType") || body.touchType,
      }),
    };
  }
  if (method === "GET" && action === "inbox") {
    return { status: 200, body: await store.listInboxTouches({ userId, emailHint }) };
  }
  if (method === "POST" && action === "busy") {
    return { status: 200, body: await store.setBusyTimes(Object.assign(base, body)) };
  }
  if (method === "POST" && action === "nudge-date") {
    const busyEvents = await store.listBusyTimes({
      userId, emailHint, weekStart: body.weekStart || body.date,
    });
    return { status: 200, body: store.nudgeOffBusyDay(body.date, busyEvents) };
  }
  if (method === "POST" && action === "touch") {
    return { status: 201, body: { touch: store.presentTouch(await store.createTouch(Object.assign(base, body))) } };
  }
  if (method === "PATCH" && action === "touch") {
    return { status: 200, body: { touch: store.presentTouch(await store.updateTouch({ id, userId, emailHint, actor, patch: body })) } };
  }
  if (method === "POST" && action === "session") {
    return { status: 201, body: { session: store.presentSession(await store.createSession(Object.assign(base, body))) } };
  }
  if (method === "PATCH" && action === "session") {
    return { status: 200, body: { session: store.presentSession(await store.updateSession({ id, userId, emailHint, actor, patch: body })) } };
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
