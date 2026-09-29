"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-drafts";
process.env.STYTCH_SECRET = "secret-test-not-real";
process.env.LEADS_OWNER_ALLOWLIST = "user-a,hunter@example.com,user-b,other@example.com";

let seq = 0;
const tables = {};
function model() {
  const rows = [];
  return {
    rows,
    async create({ data }) {
      const now = new Date(Date.UTC(2026, 8, 29, 12, 0, ++seq));
      const row = Object.assign({ id: "row_" + seq, createdAt: now, updatedAt: now }, data);
      rows.push(row);
      return row;
    },
    async findUnique({ where }) {
      if (where.id) return rows.find((row) => row.id === where.id) || null;
      if (where.userId_kind) {
        return rows.find((row) => row.userId === where.userId_kind.userId && row.kind === where.userId_kind.kind) || null;
      }
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
      const existing = await this.findUnique({ where });
      if (existing) {
        Object.assign(existing, update, { updatedAt: new Date() });
        return existing;
      }
      return this.create({ data: create });
    },
  };
}
for (const name of ["lead", "leadDraft", "leadEvent", "tinkerUserData"]) tables[name] = model();
const database = {
  $executeRawUnsafe: async () => 0,
  $transaction: async (fn) => fn(database),
  lead: tables.lead, leadDraft: tables.leadDraft, leadEvent: tables.leadEvent,
  tinkerUserData: tables.tinkerUserData,
};
function stubAt(absPath, exports) {
  const mod = new Module(absPath);
  mod.filename = absPath; mod.loaded = true; mod.exports = exports;
  require.cache[absPath] = mod;
}
const libDir = path.resolve(__dirname, "..", "api", "_lib");
stubAt(path.join(libDir, "stytch.js"), {
  authenticateSession: async (token) => {
    if (token !== "user-a" && token !== "user-b") throw Object.assign(new Error("nope"), { status: 401 });
    const email = token === "user-a" ? "hunter@example.com" : "other@example.com";
    return { session: { user_id: token }, user: { user_id: token, emails: [{ email }] } };
  },
});
stubAt(path.join(libDir, "db.js"), database);
const store = require("../api/_lib/leads-store.js");
const handler = require("../api/leads.js");
async function call({ method, token = "user-a", action, body, query }) {
  const captured = { status: null, body: null };
  await handler({
    method, url: "/api/leads", headers: { authorization: token ? "Bearer " + token : "" }, body,
    query: Object.assign({ action }, query || {}),
  }, {
    setHeader() {},
    status(code) { captured.status = code; return this; },
    json(payload) { captured.body = payload; return this; },
  });
  return captured;
}
test.beforeEach(() => {
  seq = 0;
  for (const table of Object.values(tables)) table.rows.length = 0;
  store.resetTableCache();
  process.env.LEADS_OWNER_ALLOWLIST = "user-a,hunter@example.com,user-b,other@example.com";
});

test("listDrafts returns owner drafts with lead context; create lands in needs review", async () => {
  const lead = await call({ method: "POST", action: "create", body: { personName: "Alex Rivera", company: "Acme", source: "linkedin" } });
  const leadId = lead.body.lead.id;
  const draft = await call({
    method: "POST", action: "draft",
    body: { leadId, channel: "gmail_outreach", subject: "Hi", body: "Hello", storyPartIds: ["part_1"] },
  });
  assert.equal(draft.body.draft.status, "draft");
  await call({ method: "POST", action: "approve", body: { id: draft.body.draft.id } });
  await call({ method: "POST", action: "draft", body: { leadId, channel: "linkedin_connection", body: "Note for review" } });
  const listed = await call({ method: "GET", action: "drafts" });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.drafts.length, 2);
  assert.equal(listed.body.drafts.filter((row) => row.status === "draft").length, 1);
  assert.equal(listed.body.drafts.filter((row) => row.status === "approved").length, 1);
  assert.equal(listed.body.drafts.find((row) => row.status === "approved").lead.personName, "Alex Rivera");
  assert.deepEqual(listed.body.drafts.find((row) => row.status === "approved").storyPartIds, ["part_1"]);
});

test("listDrafts includes lead-less linkedin_post and filters by company", async () => {
  const lead = await call({ method: "POST", action: "create", body: { personName: "Pat Kim", company: "Orbit", source: "posting" } });
  await call({ method: "POST", action: "draft", body: { channel: "linkedin_post", body: "Hiring thoughts" } });
  await call({ method: "POST", action: "draft", body: { leadId: lead.body.lead.id, channel: "gmail_outreach", subject: "Hi", body: "Orbit note" } });
  assert.equal((await call({ method: "GET", action: "drafts" })).body.drafts.find((r) => r.channel === "linkedin_post").lead, null);
  assert.equal((await call({ method: "GET", action: "drafts", query: { company: "Orbit" } })).body.drafts.length, 1);
});

test("cross-owner cannot list edit approve or mark-sent another account's drafts", async () => {
  const lead = await call({ method: "POST", action: "create", body: { personName: "Pat Kim", company: "Orbit", source: "posting" } });
  const draft = await call({
    method: "POST", action: "draft",
    body: { leadId: lead.body.lead.id, channel: "gmail_outreach", subject: "A", body: "Owner A only" },
  });
  const draftId = draft.body.draft.id;
  assert.deepEqual((await call({ method: "GET", token: "user-b", action: "drafts" })).body.drafts, []);
  assert.equal((await call({ method: "PATCH", token: "user-b", action: "draft", body: { id: draftId, body: "hijack" } })).status, 404);
  assert.equal((await call({ method: "POST", token: "user-b", action: "approve", body: { id: draftId } })).status, 404);
  assert.equal((await call({ method: "POST", token: "user-b", action: "mark-sent", body: { id: draftId } })).status, 404);
  const otherLead = await call({
    method: "POST", token: "user-b", action: "create",
    body: { personName: "Other Person", company: "Elsewhere", source: "event" },
  });
  await call({
    method: "POST", token: "user-b", action: "draft",
    body: { leadId: otherLead.body.lead.id, channel: "linkedin_connection", body: "B draft" },
  });
  assert.equal((await call({ method: "GET", action: "drafts" })).body.drafts[0].body, "Owner A only");
  assert.equal((await call({ method: "GET", token: "user-b", action: "drafts" })).body.drafts[0].body, "B draft");
});

test("sidebar draft center markup destinations counter from-address and no send path", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "src/renderer/lead-drafts.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
  const mobile = fs.readFileSync(path.join(root, "src/renderer/mobile-drawer.css"), "utf8");
  const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
  const api = fs.readFileSync(path.join(root, "api/leads.js"), "utf8") + fs.readFileSync(path.join(root, "api/_lib/leads-store.js"), "utf8");
  assert.match(html, /id="sidebar-drafts"/);
  assert.match(html, /lead-drafts\.js/);
  assert.match(html, /data-drafts-badge/);
  assert.match(html, /data-drafts-from/);
  assert.match(js, /Needs review/);
  assert.match(js, /Ready to send/);
  assert.match(js, /Mark sent/);
  assert.match(js, /You approve and copy; Tinker never sends/);
  assert.match(js, /linkedin_post/);
  assert.match(js, /linkedin_connection/);
  assert.match(js, /gmail_outreach/);
  assert.match(js, /LINKEDIN_CONNECTION_NOTE_MAX\s*=\s*300/);
  assert.match(js, /authuser/);
  assert.equal(/\blinkedin_message\b/.test(js), false);
  assert.equal(/\bTyler\b/.test(js + html), false);
  assert.equal(/sendgrid|providerMessageId|MESSAGING_SEND/.test(js + api), false);
  assert.match(css, /\.sidebar__drafts\b/);
  assert.match(css, /\.sidebar__drafts-counter--over\b/);
  assert.match(mobile, /\.sidebar__drafts/);
  assert.match(sw, /lead-drafts\.js/);
  assert.ok(store.listDrafts);
  assert.deepEqual(store.CHANNELS, ["linkedin_post", "linkedin_connection", "gmail_outreach"]);
});
