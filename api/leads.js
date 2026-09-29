"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { userIdFromSession } = require("./_lib/mcp-keys.js");
const { sessionIdentity } = require("./_lib/autonomy.js");
const { withResponseLogging } = require("./_lib/log.js");
const store = require("./_lib/leads-store.js");

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
  if (token.startsWith("mcp_")) throw Object.assign(new Error("Connector credentials cannot use leads."), { status: 401 });
  let session;
  try { session = await authenticateSession(token); }
  catch (err) {
    if (err.status && err.status >= 400 && err.status < 500) throw Object.assign(new Error("Session expired."), { status: 401 });
    throw err;
  }
  const userId = userIdFromSession(session);
  if (!userId) throw Object.assign(new Error("Session missing user id."), { status: 401 });
  const email = (sessionIdentity(session).emails[0] || "").slice(0, 180);
  store.assertAllowed(userId, email);
  return { userId, emailHint: email, actor: { kind: "human", label: "user:" + (email || userId) } };
}
async function dispatch(method, action, auth, body, req) {
  const { userId, emailHint, actor } = auth;
  const id = (typeof body.id === "string" && body.id.trim()) || queryValue(req, "id");
  const base = { userId, emailHint, actor };
  if (method === "GET" && (action === "list" || action === "")) {
    const leads = await store.listLeads({ userId, emailHint, stage: queryValue(req, "stage"), company: queryValue(req, "company") });
    return { status: 200, body: { leads: leads.map(store.presentLead) } };
  }
  if (method === "GET" && action === "lead") {
    const found = await store.getLead({ id, userId, emailHint });
    return { status: 200, body: { lead: store.presentLead(found.lead), drafts: found.drafts.map(store.presentDraft) } };
  }
  if (method === "GET" && action === "drafts") {
    const rows = await store.listDrafts({
      userId, emailHint, status: queryValue(req, "status"), company: queryValue(req, "company"),
    });
    return {
      status: 200,
      body: {
        drafts: rows.map(({ draft, lead }) => Object.assign(store.presentDraft(draft), {
          lead: lead ? store.presentLead(lead) : null,
        })),
      },
    };
  }
  if (method === "POST" && action === "create") {
    return { status: 201, body: { lead: store.presentLead(await store.createLead(Object.assign(base, body))) } };
  }
  if (method === "PATCH" && (action === "edit" || action === "")) {
    return { status: 200, body: { lead: store.presentLead(await store.updateLead({ id, userId, emailHint, actor, patch: body })) } };
  }
  if (method === "POST" && action === "import") {
    const leads = await store.importLeads({ userId, emailHint, actor, text: body.text });
    return { status: 201, body: { leads: leads.map(store.presentLead) } };
  }
  if (method === "POST" && action === "stage") {
    const result = await store.setStage({ id, userId, emailHint, actor, stage: body.stage, outcome: body.outcome });
    return { status: 200, body: { lead: store.presentLead(result.lead), event: store.presentEvent(result.event) } };
  }
  if (method === "POST" && action === "draft") {
    const result = await store.createDraft(Object.assign(base, body));
    return { status: 201, body: { draft: store.presentDraft(result.draft), lead: result.lead ? store.presentLead(result.lead) : null } };
  }
  if (method === "PATCH" && action === "draft") {
    return { status: 200, body: { draft: store.presentDraft(await store.updateDraft({ id, userId, emailHint, actor, patch: body })) } };
  }
  if (method === "POST" && action === "approve") {
    const result = await store.approveDraft({ id, userId, emailHint, actor });
    return { status: 200, body: { draft: store.presentDraft(result.draft), event: store.presentEvent(result.event) } };
  }
  if (method === "POST" && action === "mark-sent") {
    const result = await store.markDraftSent({ id, userId, emailHint, actor });
    return { status: 200, body: { draft: store.presentDraft(result.draft), lead: result.lead ? store.presentLead(result.lead) : null, event: store.presentEvent(result.event) } };
  }
  if (method === "GET" && action === "settings") {
    return { status: 200, body: { settings: await store.getOutreachSettings({ userId, emailHint }) } };
  }
  if (method === "POST" && action === "settings") {
    return { status: 200, body: { settings: await store.setOutreachSettings({ userId, emailHint, patch: body }) } };
  }
  const companies = require("./_lib/leads-companies-store.js");
  if (method === "GET" && action === "companies") {
    const rows = await companies.listCompanies({ userId, emailHint, status: queryValue(req, "status") });
    return { status: 200, body: { companies: rows.map(companies.presentCompany) } };
  }
  if (method === "POST" && action === "company") {
    return { status: 201, body: { company: companies.presentCompany(await companies.createCompany(Object.assign(base, body))) } };
  }
  if (method === "PATCH" && action === "company") {
    return { status: 200, body: { company: companies.presentCompany(await companies.updateCompany({ id, userId, emailHint, actor, patch: body })) } };
  }
  if (method === "GET" && action === "funnel") {
    return { status: 200, body: await companies.getFunnel({ userId, emailHint }) };
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
