/* Batched GET /api/leads?action=inbox for people-rail first paint. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const fs = require("node:fs");

process.env.STYTCH_PROJECT_ID = "project-test-inbox-batch";
process.env.STYTCH_SECRET = "secret-test-not-real";
process.env.LEADS_OWNER_ALLOWLIST = "user-a,hunter@example.com";

let seq = 0;
const tables = {};
function model() {
  const rows = [];
  return {
    rows,
    async create({ data }) {
      const now = new Date(Date.UTC(2026, 8, 29, 15, 0, ++seq));
      const row = Object.assign({ id: "row_" + seq, createdAt: now, updatedAt: now }, data);
      rows.push(row);
      return row;
    },
    async findUnique({ where }) {
      if (where.id) return rows.find((row) => row.id === where.id) || null;
      const pair = where.userId_kind;
      if (pair) return rows.find((row) => row.userId === pair.userId && row.kind === pair.kind) || null;
      return null;
    },
    async findMany({ where = {} } = {}) {
      return rows.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
    },
    async update({ where, data }) {
      const row = rows.find((item) => item.id === where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    async upsert({ where, create, update }) {
      const pair = where.userId_kind;
      const row = rows.find((item) => item.userId === pair.userId && item.kind === pair.kind);
      if (!row) return this.create({ data: create });
      Object.assign(row, update, { updatedAt: new Date() });
      return row;
    },
  };
}
for (const name of [
  "lead", "leadDraft", "leadEvent", "tinkerUserData", "targetCompany", "outreachTouch", "outreachSession",
]) tables[name] = model();

const database = {
  $executeRawUnsafe: async () => 0,
  $transaction: async (fn) => fn(database),
  lead: tables.lead,
  leadDraft: tables.leadDraft,
  leadEvent: tables.leadEvent,
  tinkerUserData: tables.tinkerUserData,
  targetCompany: tables.targetCompany,
  outreachTouch: tables.outreachTouch,
  outreachSession: tables.outreachSession,
};

function stubAt(absPath, exports) {
  const mod = new Module(absPath);
  mod.filename = absPath;
  mod.loaded = true;
  mod.exports = exports;
  require.cache[absPath] = mod;
}
const libDir = path.resolve(__dirname, "..", "api", "_lib");
for (const rel of [
  "db.js", "stytch.js", "mcp-keys.js", "leads-store.js", "leads-companies-store.js",
  "outreach-schedule-store.js",
]) {
  delete require.cache[path.join(libDir, rel)];
}
delete require.cache[path.join(__dirname, "..", "api", "leads.js")];

stubAt(path.join(libDir, "stytch.js"), {
  authenticateSession: async (token) => {
    if (token !== "user-a") throw Object.assign(new Error("nope"), { status: 401 });
    return { session: { user_id: token }, user: { user_id: token, emails: [{ email: "hunter@example.com" }] } };
  },
});
stubAt(path.join(libDir, "db.js"), database);
stubAt(path.join(libDir, "mcp-keys.js"), {
  isMcpApiKey: () => false,
  authenticateMcpKey: async () => { throw Object.assign(new Error("no"), { status: 401 }); },
  userIdFromSession: (s) => (s && s.session && s.session.user_id) || "",
});

const store = require("../api/_lib/leads-store.js");
const companies = require("../api/_lib/leads-companies-store.js");
const schedule = require("../api/_lib/outreach-schedule-store.js");
const handler = require("../api/leads.js");

async function call(action) {
  const captured = { status: null, body: null };
  await handler({
    method: "GET",
    url: "/api/leads?action=" + action,
    headers: { authorization: "Bearer user-a" },
    query: { action },
  }, {
    setHeader() {},
    status(code) { captured.status = code; return this; },
    json(payload) { captured.body = payload; return this; },
  });
  return captured;
}

test.beforeEach(() => {
  seq = 0;
  Object.keys(tables).forEach((name) => { tables[name].rows.length = 0; });
});

test("action=inbox returns leads, drafts, companies, touches, and profile in one response", async () => {
  const company = await companies.createCompany({
    userId: "user-a", emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    name: "Alloy", domain: "alloy.com", status: "active",
  });
  const lead = await store.createLead({
    userId: "user-a", emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    personName: "Andrew Glenn", personTitle: "VP Eng", company: "Alloy",
    companyId: company.id, contactType: "hiring_leader", source: "other", stage: "new",
    linkedInUrl: "https://www.linkedin.com/in/andrew-glenn-person",
  });
  await store.createDraft({
    userId: "user-a", emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    leadId: lead.id, channel: "gmail_outreach", body: "hello",
  });
  await schedule.createTouch({
    userId: "user-a", emailHint: "hunter@example.com",
    actor: { kind: "human", label: "user:hunter@example.com" },
    companyId: company.id, leadId: lead.id,
    touchType: "hiring_leader_outreach", date: "2026-09-30", status: "planned",
  });
  await database.tinkerUserData.create({
    data: {
      userId: "user-a",
      kind: "profile",
      data: {
        name: "Tyler Lindow",
        title: "Founder at Lindow Labs",
        linkedInUrl: "https://www.linkedin.com/in/tyler-owner",
      },
    },
  });

  const out = await call("inbox");
  assert.equal(out.status, 200);
  assert.equal(out.body.leads.length, 1);
  assert.equal(out.body.leads[0].personName, "Andrew Glenn");
  assert.equal(out.body.drafts.length, 1);
  assert.equal(out.body.companies.length, 1);
  assert.equal(out.body.companies[0].domain, "alloy.com");
  assert.ok(out.body.byLeadId[lead.id]);
  assert.equal(out.body.profile.title, "Founder at Lindow Labs");
  assert.equal(out.body.profile.linkedInUrl, "https://www.linkedin.com/in/tyler-owner");
});

test("shell uses batched inbox + local snapshot cache + deferred logos", () => {
  const root = path.join(__dirname, "..");
  const js = fs.readFileSync(path.join(root, "src/renderer/messages-shell.js"), "utf8");
  const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
  assert.match(js, /leadsApi\(["']inbox["']\)/);
  assert.match(js, /tinker\.inboxSnapshot/);
  assert.match(js, /readInboxCache/);
  assert.match(js, /writeInboxCache/);
  assert.match(js, /deferLogoFill|requestIdleCallback/);
  assert.match(js, /loading:\s*["']lazy["']/);
  assert.match(sw, /tinker-shell-v12/);
  assert.match(sw, /messages-notepad\.js/);
  assert.match(sw, /staleWhileRevalidate/);
});
