/* TYL-62 companies + funnel. Postgres stubbed. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
process.env.STYTCH_PROJECT_ID = "project-test-companies";
process.env.STYTCH_SECRET = "secret-test-not-real";
process.env.LEADS_OWNER_ALLOWLIST = "user-a,hunter@example.com,user-b,other@example.com";
let seq = 0;
const tables = {};
function model() {
  const rows = [];
  return {
    rows,
    async create({ data }) {
      const now = new Date(Date.UTC(2026, 8, 29, 14, 0, ++seq));
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
delete require.cache[require.resolve("../api/_lib/leads-companies-store.js")];
delete require.cache[require.resolve("../api/leads.js")];
const store = require("../api/_lib/leads-store.js");
const companies = require("../api/_lib/leads-companies-store.js");
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
  companies.resetTableCache();
  process.env.LEADS_OWNER_ALLOWLIST = "user-a,hunter@example.com,user-b,other@example.com";
});
test("company migration and one north star", async () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma/migrations/20260929080000_leads_companies_funnel/migration.sql"), "utf8");
  for (const statement of companies.TABLE_STATEMENTS) assert.ok(sql.includes(statement));
  const first = await call({ method: "POST", action: "company", body: { name: "Acme", domain: "acme.com", northStar: true, totalComp: 250000, totalCompSource: "levels" } });
  assert.equal(first.status, 201);
  assert.equal(first.body.company.northStar, true);
  const second = await call({ method: "POST", action: "company", body: { name: "Orbit", domain: "orbit.dev", northStar: true } });
  assert.equal(second.body.company.northStar, true);
  assert.equal(tables.targetCompany.rows.filter((row) => row.northStar).length, 1);
  assert.equal((await call({ method: "GET", token: "user-b", action: "companies" })).body.companies.length, 0);
  assert.equal((await call({ method: "PATCH", token: "user-b", action: "company", body: { id: first.body.company.id, name: "Nope" } })).status, 404);
});
test("funnel orders referrer first and sorts pay below floor", async () => {
  await call({ method: "POST", action: "settings", body: { minTotalComp: 200000 } });
  const acme = await call({ method: "POST", action: "company", body: { name: "Acme", domain: "acme.com", northStar: true, totalComp: 220000 } });
  const orbit = await call({ method: "POST", action: "company", body: { name: "Orbit", totalComp: 150000 } });
  const nova = await call({ method: "POST", action: "company", body: { name: "Nova", totalComp: 300000 } });
  await call({ method: "POST", action: "create", body: { personName: "Ref", company: "Acme", companyId: acme.body.company.id, contactType: "referrer", queueOrder: 1, source: "referral" } });
  await call({ method: "POST", action: "create", body: { personName: "Rec", company: "Acme", companyId: acme.body.company.id, contactType: "recruiter", queueOrder: 1, source: "linkedin" } });
  await call({ method: "POST", action: "create", body: { personName: "Lead", company: "Acme", companyId: acme.body.company.id, contactType: "hiring_leader", queueOrder: 2, source: "other" } });
  const funnel = await call({ method: "GET", action: "funnel" });
  assert.equal(funnel.body.companies[0].company.id, acme.body.company.id);
  assert.equal(funnel.body.companies[0].nextReferrer.personName, "Ref");
  assert.equal(funnel.body.companies[0].nextRecruiter.personName, "Rec");
  assert.equal(funnel.body.companies[0].payStatus, "clears");
  assert.equal(funnel.body.companies[1].company.id, nova.body.company.id);
  assert.equal(funnel.body.companies[2].company.id, orbit.body.company.id);
  assert.equal(funnel.body.companies[2].payStatus, "below");
  assert.equal((await call({ method: "GET", token: "user-b", action: "funnel" })).body.companies.length, 0);
});
test("import matches companies by name", async () => {
  await call({ method: "POST", action: "company", body: { name: "Paste Co", domain: "paste.co" } });
  const imported = await call({ method: "POST", action: "import", body: { text: JSON.stringify([{ personName: "Casey", company: "Paste Co", contactType: "recruiter", source: "other" }]) } });
  assert.equal(imported.status, 201);
  assert.ok(imported.body.leads[0].companyId);
  assert.equal(tables.targetCompany.rows.filter((row) => row.userId === "user-a").length, 1);
});
