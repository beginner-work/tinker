/* TYL-63 sidebar draft center on funnel/channels base. */
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
      rows.push(row); return row;
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
      Object.assign(row, data, { updatedAt: new Date() }); return row;
    },
    async upsert({ where, create, update }) {
      const pair = where.userId_kind;
      const row = rows.find((item) => item.userId === pair.userId && item.kind === pair.kind);
      if (!row) return this.create({ data: create });
      Object.assign(row, update, { updatedAt: new Date() }); return row;
    },
  };
}
for (const name of ["lead", "leadDraft", "leadEvent", "tinkerUserData", "targetCompany"]) tables[name] = model();
const database = {
  $executeRawUnsafe: async () => 0, $transaction: async (fn) => fn(database),
  lead: tables.lead, leadDraft: tables.leadDraft, leadEvent: tables.leadEvent,
  tinkerUserData: tables.tinkerUserData, targetCompany: tables.targetCompany,
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
delete require.cache[require.resolve("../api/_lib/leads-store.js")];
delete require.cache[require.resolve("../api/leads.js")];
const store = require("../api/_lib/leads-store.js");
const handler = require("../api/leads.js");
async function call({ method, token = "user-a", action, body, query }) {
  const captured = { status: null, body: null };
  await handler({
    method, url: "/api/leads", headers: { authorization: token ? "Bearer " + token : "" }, body,
    query: Object.assign({ action }, query || {}),
  }, { setHeader() {}, status(code) { captured.status = code; return this; }, json(payload) { captured.body = payload; return this; } });
  return captured;
}
test.beforeEach(() => {
  seq = 0;
  for (const table of Object.values(tables)) table.rows.length = 0;
  store.resetTableCache();
  process.env.LEADS_OWNER_ALLOWLIST = "user-a,hunter@example.com,user-b,other@example.com";
});

test("listDrafts destinations and needs-review create; company filter", async () => {
  const lead = await call({ method: "POST", action: "create", body: { personName: "Alex Rivera", company: "Acme", source: "linkedin" } });
  const leadId = lead.body.lead.id;
  const draft = await call({ method: "POST", action: "draft", body: { leadId, channel: "gmail_outreach", subject: "Hi", body: "Hello", storyPartIds: ["part_1"] } });
  assert.equal(draft.body.draft.status, "draft");
  assert.equal(draft.body.draft.channel, "gmail_outreach");
  await call({ method: "POST", action: "approve", body: { id: draft.body.draft.id } });
  await call({ method: "POST", action: "draft", body: { leadId, channel: "linkedin_connection", body: "Note" } });
  await call({ method: "POST", action: "draft", body: { channel: "linkedin_post", body: "A post with no lead." } });
  const listed = await call({ method: "GET", action: "drafts" });
  assert.equal(listed.body.drafts.length, 3);
  assert.equal(listed.body.drafts.filter((row) => row.channel === "linkedin_post" && !row.lead).length, 1);
  const byCompany = await call({ method: "GET", action: "drafts", query: { company: "acme" } });
  assert.ok(byCompany.body.drafts.every((row) => row.lead && row.lead.company === "Acme"));
});

test("cross-owner cannot list edit approve or mark-sent another's drafts", async () => {
  const lead = await call({ method: "POST", action: "create", body: { personName: "Pat Kim", company: "Orbit", source: "posting" } });
  const draft = await call({ method: "POST", action: "draft", body: { leadId: lead.body.lead.id, channel: "gmail_outreach", body: "Owner A only" } });
  const draftId = draft.body.draft.id;
  assert.deepEqual((await call({ method: "GET", token: "user-b", action: "drafts" })).body.drafts, []);
  assert.equal((await call({ method: "PATCH", token: "user-b", action: "draft", body: { id: draftId, body: "hijack" } })).status, 404);
  assert.equal((await call({ method: "POST", token: "user-b", action: "approve", body: { id: draftId } })).status, 404);
  assert.equal((await call({ method: "POST", token: "user-b", action: "mark-sent", body: { id: draftId } })).status, 404);
});

test("sidebar destinations, LinkedIn limit citation, no send path", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "src/renderer/lead-drafts.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
  const api = fs.readFileSync(path.join(root, "api/leads.js"), "utf8") + fs.readFileSync(path.join(root, "api/_lib/leads-store.js"), "utf8");
  assert.match(html, /id="sidebar-drafts"/);
  assert.match(html, /Outreach settings|sidebar__drafts--settings/);
  assert.match(js, /linkedin_post|linkedin_connection|gmail_outreach/);
  assert.match(js, /LINKEDIN_CONNECTION_NOTE_LIMIT\s*=\s*200/);
  assert.match(js, /a563153/);
  assert.match(js, /authuser/);
  assert.match(js, /aria-label/);
  assert.match(js, /add linkedin_message later/);
  assert.equal(/DESTINATIONS\s*=\s*\{[^}]*linkedin_message/.test(js), false);
  assert.equal(/\bTyler\b/.test(js + html), false);
  assert.equal(/sendgrid|MESSAGING_SEND/.test(js + api), false);
  assert.match(css, /\.sidebar__drafts\b/);
  assert.ok(store.listDrafts);
  assert.deepEqual(store.CHANNELS, ["linkedin_post", "linkedin_connection", "gmail_outreach"]);
});

test("bookingUrl settings and reply-only insert control", async () => {
  assert.equal((await call({ method: "GET", action: "settings" })).body.settings.bookingUrl, "");
  const set = await call({ method: "POST", action: "settings", body: { bookingUrl: "https://cal.example/you" } });
  assert.equal(set.body.settings.bookingUrl, "https://cal.example/you");
  const js = fs.readFileSync(path.join(__dirname, "..", "src/renderer/lead-drafts.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "src/renderer/index.html"), "utf8");
  assert.match(js, /Insert booking link/);
  assert.match(js, /isReplyDraft/);
  assert.match(js, /REPLY_STAGES/);
  assert.match(html, /data-drafts-booking/);
  assert.equal(/linkedin_post[^\n]*isReplyDraft|isReplyDraft[^\n]*linkedin_post/.test(js) || js.includes('channel === "linkedin_post"'), true);
});
