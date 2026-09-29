/* TYL-62 leads slice 1. Postgres is stubbed. No send path. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-leads";
process.env.STYTCH_SECRET = "secret-test-not-real";

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
});

test("migration matches and no send path exists", () => {
  const root = path.join(__dirname, "..");
  const migration = fs.readFileSync(path.join(root, "prisma/migrations/20260929060000_add_leads/migration.sql"), "utf8");
  for (const statement of store.TABLE_STATEMENTS) assert.ok(migration.includes(statement));
  const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  assert.ok(schema.includes("model Lead") && schema.includes("model LeadDraft") && schema.includes("model LeadEvent"));
  assert.equal(schema.includes("model Messaging"), false);
  const source = fs.readFileSync(path.join(libDir, "leads-store.js"), "utf8")
    + fs.readFileSync(path.join(root, "api/leads.js"), "utf8") + migration + schema;
  for (const word of ["sendgrid", "apollo", "MessagingContact", "doNotContact", "pending_approval", "providerMessageId", "MESSAGING_SEND", "tyler:"]) {
    assert.equal(source.includes(word), false, word);
  }
  assert.ok(source.includes("sent_by_owner"));
  assert.equal(source.includes('status: "sent"'), false);
  assert.equal(source.includes("sentAt"), false);
  assert.equal(typeof store.sendMessage, "undefined");
  const emails = fs.readFileSync(__filename, "utf8").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  assert.ok(emails.length > 0 && emails.every((email) => email.endsWith("@example.com")));
});

test("owner scoping and list filters", async () => {
  const created = await call({
    method: "POST", action: "create",
    body: { personName: "Alex Rivera", personTitle: "Eng Manager", company: "Acme", source: "linkedin", targetRoleTitle: "Staff" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.lead.stage, "new");
  const id = created.body.lead.id;
  assert.equal((await call({ method: "GET", token: "user-b", action: "lead", query: { id } })).status, 404);
  assert.deepEqual((await call({ method: "GET", token: "user-b", action: "list" })).body.leads, []);
  assert.equal((await call({ method: "POST", token: "mcp_key", action: "create", body: { personName: "No" } })).status, 401);
  await call({ method: "POST", action: "create", body: { personName: "Other", company: "Beta", source: "referral" } });
  const byStage = await call({ method: "GET", action: "list", query: { stage: "new", company: "acme" } });
  assert.deepEqual(byStage.body.leads.map((lead) => lead.id), [id]);
  assert.equal(tables.leadEvent.rows[0].actor, "user:hunter@example.com");
});

test("import parses CSV headers and plain lines", async () => {
  const csv = await call({
    method: "POST", action: "import",
    body: { text: "Name,Title,Company,Email,LinkedIn,Source\nSam Lee,PM,Orbit,sam@example.com,https://linkedin.com/in/sam,referral\n" },
  });
  assert.equal(csv.status, 201);
  assert.equal(csv.body.leads[0].personName, "Sam Lee");
  assert.equal(csv.body.leads[0].source, "referral");
  assert.equal(csv.body.leads[0].email, "sam@example.com");
  const lines = await call({
    method: "POST", action: "import",
    body: { text: "Jordan Blake,Recruiter,Nova\nCasey,Engineer,Orbit,casey@example.com" },
  });
  assert.equal(lines.body.leads.length, 2);
  assert.equal(lines.body.leads[0].company, "Nova");
  assert.equal(store.parseImportText("Just One Name")[0].personName, "Just One Name");
});

test("stage outcomes, drafts, approve, and mark-sent", async () => {
  const created = await call({ method: "POST", action: "create", body: { personName: "Pat Kim", company: "Orbit", source: "posting" } });
  const leadId = created.body.lead.id;
  const draft = await call({
    method: "POST", action: "draft",
    body: { leadId, channel: "email", subject: "Hello", body: "Quick note.", storyPartIds: ["part_1"] },
  });
  assert.equal(draft.status, 201);
  assert.equal(draft.body.draft.status, "draft");
  assert.equal(draft.body.lead.stage, "drafting");
  assert.deepEqual(draft.body.draft.storyPartIds, ["part_1"]);
  const draftId = draft.body.draft.id;
  assert.equal((await call({ method: "PATCH", action: "draft", body: { id: draftId, body: "Tighter note." } })).body.draft.body, "Tighter note.");
  const approved = await call({ method: "POST", action: "approve", body: { id: draftId } });
  assert.equal(approved.body.draft.status, "approved");
  assert.equal(approved.body.event.actor, "user:hunter@example.com");
  const sent = await call({ method: "POST", action: "mark-sent", body: { id: draftId } });
  assert.equal(sent.body.draft.status, "sent_by_owner");
  assert.equal(sent.body.lead.stage, "contacted");
  assert.equal(sent.body.event.action, "draft_sent_by_owner");
  const outcome = await call({ method: "POST", action: "stage", body: { id: leadId, outcome: "replied" } });
  assert.equal(outcome.body.lead.stage, "replied");
  assert.equal(outcome.body.event.action, "outcome");
  assert.equal((await call({ method: "GET", action: "lead", query: { id: leadId } })).body.drafts[0].status, "sent_by_owner");
  assert.equal((await call({ method: "POST", action: "mark-sent", body: { id: draftId } })).status, 400);
  assert.equal((await call({ method: "POST", action: "create", body: { personName: "X", source: "apollo" } })).status, 400);
});
