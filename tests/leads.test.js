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
  const migrations = fs.readFileSync(path.join(root, "prisma/migrations/20260929060000_add_leads/migration.sql"), "utf8")
    + fs.readFileSync(path.join(root, "prisma/migrations/20260929070000_leads_draft_channels/migration.sql"), "utf8")
    + fs.readFileSync(path.join(root, "prisma/migrations/20260929080000_leads_companies_funnel/migration.sql"), "utf8");
  for (const statement of store.TABLE_STATEMENTS) assert.ok(migrations.includes(statement), statement.slice(0, 60));
  assert.deepEqual(store.CHANNELS, ["linkedin_post", "linkedin_connection", "gmail_outreach"]);
  const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  assert.ok(schema.includes("fromAddress") && schema.includes("leadId       String?"));
  const source = fs.readFileSync(path.join(libDir, "leads-store.js"), "utf8") + fs.readFileSync(path.join(root, "api/leads.js"), "utf8") + migrations + schema;
  for (const word of ["sendgrid", "apollo", "MessagingContact", "doNotContact", "pending_approval", "providerMessageId", "MESSAGING_SEND", "tyler:"]) {
    assert.equal(source.includes(word), false, word);
  }
  process.env.LEADS_OWNER_ALLOWLIST = "";
  assert.throws(() => store.assertAllowed("user-a", "hunter@example.com"), (err) => err.status === 403);
});
test("owner A cannot list get update import or draft against owner B", async () => {
  const created = await call({ method: "POST", action: "create", body: { personName: "Alex Rivera", company: "Acme", source: "linkedin" } });
  const id = created.body.lead.id;
  assert.equal((await call({ method: "GET", token: "user-b", action: "lead", query: { id } })).status, 404);
  assert.equal((await call({ method: "POST", token: "user-b", action: "draft", body: { leadId: id, channel: "gmail_outreach", body: "hi" } })).status, 404);
  assert.equal((await call({ method: "POST", token: "user-b", action: "draft", body: { channel: "linkedin_post", body: "post" } })).status, 201);
  assert.equal(tables.leadDraft.rows.filter((row) => row.userId === "user-b" && !row.leadId).length, 1);
  const bDraftId = tables.leadDraft.rows.find((row) => row.userId === "user-b").id;
  assert.equal((await call({ method: "POST", token: "user-a", action: "approve", body: { id: bDraftId } })).status, 404);
  process.env.LEADS_OWNER_ALLOWLIST = "user-a";
  assert.equal((await call({ method: "GET", token: "user-b", action: "list" })).status, 403);
});
test("import accepts new channels fromAddress and dedupes", async () => {
  const csv = await call({
    method: "POST", action: "import",
    body: { text: "Name,Company,Source,Stage,DraftChannel,DraftSubject,DraftBody,DraftStatus,FromAddress\nSam Lee,Orbit,referral,contacted,gmail_outreach,Hi,Body,sent_by_owner,me@example.com\n" },
  });
  assert.equal(csv.status, 201);
  assert.equal(tables.leadDraft.rows[0].channel, "gmail_outreach");
  assert.equal(tables.leadDraft.rows[0].fromAddress, "me@example.com");
  const again = await call({
    method: "POST", action: "import",
    body: { text: JSON.stringify([{ personName: "Sam Lee", company: "Orbit", source: "linkedin", stage: "replied", draft: { channel: "linkedin_connection", body: "Note", status: "draft" } }]) },
  });
  assert.equal(again.body.leads[0].stage, "replied");
  assert.equal(tables.lead.rows.filter((row) => row.personName === "Sam Lee").length, 1);
});
test("Tyler email seeds outreach-from when empty; others stay blank", async () => {
  const seeded = await store.getOutreachSettings({
    userId: "user-a",
    emailHint: "tyler.lindow@gmail.com",
  });
  assert.equal(seeded.defaultFromAddress, "tyler@lindowlabs.dev");
  const again = await store.getOutreachSettings({
    userId: "user-a",
    emailHint: "tyler.lindow@gmail.com",
  });
  assert.equal(again.defaultFromAddress, "tyler@lindowlabs.dev");
  const other = await store.getOutreachSettings({
    userId: "user-b",
    emailHint: "other@example.com",
  });
  assert.equal(other.defaultFromAddress, "");
  await store.setOutreachSettings({
    userId: "user-a",
    emailHint: "tyler.lindow@gmail.com",
    patch: { defaultFromAddress: "custom@lindowlabs.dev" },
  });
  const custom = await store.getOutreachSettings({
    userId: "user-a",
    emailHint: "tyler.lindow@gmail.com",
  });
  assert.equal(custom.defaultFromAddress, "custom@lindowlabs.dev");
});

test("draft channels fromAddress settings and mark-sent", async () => {
  assert.equal((await call({ method: "POST", action: "settings", body: { defaultFromAddress: "hunt@example.com" } })).body.settings.defaultFromAddress, "hunt@example.com");
  const created = await call({ method: "POST", action: "create", body: { personName: "Pat Kim", company: "Orbit", source: "posting" } });
  const leadId = created.body.lead.id;
  const draft = await call({ method: "POST", action: "draft", body: { leadId, channel: "gmail_outreach", subject: "Hello", body: "Quick note.", storyPartIds: ["part_1"] } });
  assert.equal(draft.body.draft.fromAddress, "hunt@example.com");
  assert.equal(draft.body.lead.stage, "drafting");
  const post = await call({ method: "POST", action: "draft", body: { channel: "linkedin_post", body: "Shipping a write-up." } });
  assert.equal(post.status, 201);
  assert.equal(post.body.lead, null);
  assert.equal(post.body.draft.leadId, null);
  assert.equal((await call({ method: "POST", token: "user-b", action: "approve", body: { id: post.body.draft.id } })).status, 404);
  const draftId = draft.body.draft.id;
  assert.equal((await call({ method: "POST", action: "approve", body: { id: draftId } })).body.draft.status, "approved");
  const sent = await call({ method: "POST", action: "mark-sent", body: { id: draftId } });
  assert.equal(sent.body.draft.status, "sent_by_owner");
  assert.equal(sent.body.lead.stage, "contacted");
  assert.equal((await call({ method: "POST", action: "draft", body: { channel: "linkedin_connection", body: "hi" } })).status, 400);
});
