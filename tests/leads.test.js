/* TYL-62 leads slice 1. Postgres is stubbed. No send path. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
process.env.STYTCH_PROJECT_ID = "project-test-leads";
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
    async findUnique({ where }) { return where.id ? rows.find((row) => row.id === where.id) || null : null; },
    async findMany({ where = {} } = {}) {
      return rows.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value));
    },
    async update({ where, data }) {
      const row = rows.find((item) => item.id === where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
  };
}
for (const name of ["lead", "leadDraft", "leadEvent"]) tables[name] = model();
const database = {
  $executeRawUnsafe: async () => 0, $transaction: async (fn) => fn(database),
  lead: tables.lead, leadDraft: tables.leadDraft, leadEvent: tables.leadEvent,
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
test("migration matches, allowlist gates, and no send path", () => {
  const root = path.join(__dirname, "..");
  const migration = fs.readFileSync(path.join(root, "prisma/migrations/20260929060000_add_leads/migration.sql"), "utf8");
  for (const statement of store.TABLE_STATEMENTS) assert.ok(migration.includes(statement));
  const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  assert.ok(schema.includes("model Lead") && schema.includes("model LeadDraft") && schema.includes("model LeadEvent"));
  const source = fs.readFileSync(path.join(libDir, "leads-store.js"), "utf8") + fs.readFileSync(path.join(root, "api/leads.js"), "utf8") + migration + schema;
  for (const word of ["sendgrid", "apollo", "MessagingContact", "doNotContact", "pending_approval", "providerMessageId", "MESSAGING_SEND", "tyler:"]) {
    assert.equal(source.includes(word), false, word);
  }
  assert.ok(source.includes("sent_by_owner") && source.includes("LEADS_OWNER_ALLOWLIST"));
  process.env.LEADS_OWNER_ALLOWLIST = "";
  assert.throws(() => store.assertAllowed("user-a", "hunter@example.com"), (err) => err.status === 403);
});
test("owner A cannot list get update import or draft against owner B", async () => {
  const created = await call({ method: "POST", action: "create", body: { personName: "Alex Rivera", company: "Acme", source: "linkedin" } });
  assert.equal(created.status, 201);
  const id = created.body.lead.id;
  assert.equal((await call({ method: "GET", token: "user-b", action: "lead", query: { id } })).status, 404);
  assert.deepEqual((await call({ method: "GET", token: "user-b", action: "list" })).body.leads, []);
  assert.equal((await call({ method: "PATCH", token: "user-b", action: "edit", body: { id, notes: "x" } })).status, 404);
  assert.equal((await call({ method: "POST", token: "user-b", action: "draft", body: { leadId: id, channel: "email", body: "hi" } })).status, 404);
  assert.equal((await call({ method: "POST", token: "user-b", action: "stage", body: { id, outcome: "replied" } })).status, 404);
  const otherImport = await call({ method: "POST", token: "user-b", action: "import", body: { text: "Alex Rivera,Title,Acme" } });
  assert.equal(otherImport.status, 201);
  assert.equal(tables.lead.rows.filter((row) => row.userId === "user-a").length, 1);
  assert.equal(tables.lead.rows.filter((row) => row.userId === "user-b").length, 1);
  assert.equal((await call({ method: "POST", token: "mcp_key", action: "create", body: { personName: "No" } })).status, 401);
  process.env.LEADS_OWNER_ALLOWLIST = "user-a";
  assert.equal((await call({ method: "GET", token: "user-b", action: "list" })).status, 403);
  const listed = await call({ method: "GET", action: "list", query: { stage: "new", company: "acme" } });
  assert.deepEqual(listed.body.leads.map((lead) => lead.id), [id]);
});
test("import parses CSV JSON stage draft and dedupes person+company", async () => {
  const csv = await call({
    method: "POST", action: "import",
    body: { text: "Name,Company,Source,Stage,DraftChannel,DraftSubject,DraftBody,DraftStatus\nSam Lee,Orbit,referral,contacted,email,Hi,Body,sent_by_owner\n" },
  });
  assert.equal(csv.status, 201);
  assert.equal(csv.body.leads[0].stage, "contacted");
  assert.equal(tables.leadDraft.rows[0].status, "sent_by_owner");
  const again = await call({
    method: "POST", action: "import",
    body: { text: JSON.stringify([{ personName: "Sam Lee", company: "Orbit", source: "linkedin", stage: "replied", draft: { channel: "linkedin_note", body: "Note", status: "draft" } }]) },
  });
  assert.equal(again.body.leads[0].stage, "replied");
  assert.equal(again.body.leads[0].source, "linkedin");
  assert.equal(tables.lead.rows.filter((row) => row.userId === "user-a" && row.personName === "Sam Lee").length, 1);
  assert.equal(tables.leadDraft.rows.length, 2);
});
test("draft approve mark-sent and outcomes", async () => {
  const created = await call({ method: "POST", action: "create", body: { personName: "Pat Kim", company: "Orbit", source: "posting" } });
  const leadId = created.body.lead.id;
  const draft = await call({ method: "POST", action: "draft", body: { leadId, channel: "email", subject: "Hello", body: "Quick note.", storyPartIds: ["part_1"] } });
  assert.equal(draft.body.lead.stage, "drafting");
  assert.deepEqual(draft.body.draft.storyPartIds, ["part_1"]); assert.equal(tables.leadEvent.rows[0].actor, "user:hunter@example.com");
  const draftId = draft.body.draft.id;
  assert.equal((await call({ method: "POST", action: "approve", body: { id: draftId } })).body.draft.status, "approved");
  const sent = await call({ method: "POST", action: "mark-sent", body: { id: draftId } });
  assert.equal(sent.body.draft.status, "sent_by_owner");
  assert.equal(sent.body.lead.stage, "contacted");
  assert.equal((await call({ method: "POST", action: "stage", body: { id: leadId, outcome: "replied" } })).body.lead.stage, "replied");
  assert.equal((await call({ method: "POST", action: "mark-sent", body: { id: draftId } })).status, 400);
});
