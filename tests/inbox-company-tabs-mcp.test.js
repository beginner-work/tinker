/* Company inbox MCP: upsert_target_company, upsert_lead_person, list_target_companies. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const Module = require("node:module");
const fs = require("node:fs");

process.env.STYTCH_PROJECT_ID = "project-test-company-tabs";
process.env.STYTCH_SECRET = "secret-test-not-real";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
// Intentionally empty / non-matching: leads must work for every owner.
process.env.LEADS_OWNER_ALLOWLIST = "";

let seq = 0;
const tables = {};
function model() {
  const rows = [];
  return {
    rows,
    async create({ data }) {
      const now = new Date(Date.UTC(2026, 8, 29, 20, 0, ++seq));
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
  lead: tables.lead, leadDraft: tables.leadDraft, leadEvent: tables.leadEvent,
  tinkerUserData: tables.tinkerUserData, targetCompany: tables.targetCompany,
  outreachTouch: tables.outreachTouch, outreachSession: tables.outreachSession,
};
function stubAt(absPath, exports) {
  const mod = new Module(absPath);
  mod.filename = absPath; mod.loaded = true; mod.exports = exports;
  require.cache[absPath] = mod;
}
const libDir = path.resolve(__dirname, "..", "api", "_lib");
const apiDir = path.resolve(__dirname, "..", "api");
for (const rel of [
  "db.js", "stytch.js", "mcp-keys.js", "leads-store.js", "leads-companies-store.js",
  "outreach-schedule-store.js", "self-thread-store.js",
]) delete require.cache[path.join(libDir, rel)];
delete require.cache[path.join(apiDir, "mcp.js")];
stubAt(path.join(libDir, "stytch.js"), {
  authenticateSession: async (token) => {
    if (token !== "user-a") throw Object.assign(new Error("nope"), { status: 401 });
    return { session: { user_id: token }, user: { user_id: token, emails: [{ email: "hunter@example.com" }] } };
  },
});
stubAt(path.join(libDir, "db.js"), database);
stubAt(path.join(libDir, "mcp-keys.js"), {
  isMcpApiKey: (t) => typeof t === "string" && t.startsWith("mcp_"),
  authenticateMcpKey: async (token) => {
    if (token === "mcp_" + "a".repeat(43)) return { id: "k1", label: "bot", userId: "user-a" };
    throw Object.assign(new Error("Invalid API key."), { status: 401 });
  },
  userIdFromSession: (s) => (s && s.session && s.session.user_id) || "",
});
const mcp = require("../api/mcp.js");
const companies = require("../api/_lib/leads-companies-store.js");
const leads = require("../api/_lib/leads-store.js");
const schedule = require("../api/_lib/outreach-schedule-store.js");
function fakeRes() {
  const captured = { status: null, body: null, headers: {} };
  return {
    captured,
    setHeader(k, v) { captured.headers[String(k).toLowerCase()] = v; },
    status(c) { captured.status = c; return this; },
    json(p) { captured.body = p; return this; },
    end() { return this; },
  };
}
async function mcpCall(name, args) {
  const res = fakeRes();
  await mcp({
    method: "POST", url: "/api/mcp",
    headers: { authorization: "Bearer " + "mcp_" + "a".repeat(43) },
    body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } },
  }, res);
  return res.captured;
}
test.beforeEach(() => {
  seq = 0;
  for (const table of Object.values(tables)) table.rows.length = 0;
  companies.resetTableCache();
  leads.resetTableCache();
  schedule.resetTableCache();
});
test("upsert_target_company and list_target_companies", async () => {
  const created = await mcpCall("upsert_target_company", {
    name: "Stripe", priority: 1, tier: "north_star", notes: "Primary chase",
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.result.isError, undefined);
  assert.equal(created.body.result.structuredContent.company.tier, "north_star");
  assert.equal(created.body.result.structuredContent.company.northStar, true);
  await mcpCall("upsert_target_company", { name: "Notion", priority: 2, tier: "wave_1" });
  const listed = await mcpCall("list_target_companies", {});
  assert.equal(listed.body.result.structuredContent.companies.length, 2);
  assert.equal(listed.body.result.structuredContent.companies[0].company.name, "Stripe");
});
test("MCP-authenticated owner can create a company and a person with no allowlist", async () => {
  process.env.LEADS_OWNER_ALLOWLIST = "";
  const company = await mcpCall("upsert_target_company", {
    name: "Acme Test Co",
    priority: 3,
    tier: "wave_1",
    notes: "MCP gate regression",
  });
  assert.equal(company.status, 200);
  assert.equal(company.body.result.isError, undefined);
  assert.equal(company.body.result.structuredContent.company.name, "Acme Test Co");

  // Even a leftover restrictive allowlist must not block owners (Tinker is free).
  process.env.LEADS_OWNER_ALLOWLIST = "not-this-user,other@example.com";
  const person = await mcpCall("upsert_lead_person", {
    personName: "Morgan Kim",
    companyName: "Acme Test Co",
    contactType: "referrer",
    personTitle: "EM",
    linkedInUrl: "https://www.linkedin.com/in/morgan-kim-test",
    nextStep: "Referral intro",
    dueDate: "2026-09-30T15:00:00.000Z",
    queueOrder: 0,
    touchType: "referral_outreach",
  });
  assert.equal(person.status, 200);
  assert.equal(person.body.result.isError, undefined);
  assert.equal(person.body.result.structuredContent.lead.personName, "Morgan Kim");
  assert.equal(person.body.result.structuredContent.lead.contactType, "referrer");
  assert.equal(person.body.result.structuredContent.touch.touchType, "referral_outreach");

  const listed = await mcpCall("list_target_companies", {});
  assert.equal(listed.body.result.isError, undefined);
  const row = listed.body.result.structuredContent.companies.find((c) => c.company.name === "Acme Test Co");
  assert.ok(row);
  assert.equal(row.people.length, 1);
  assert.equal(row.people[0].personName, "Morgan Kim");
});
test("upsert_target_company notes-only does not wipe tier, priority, domain, or status", async () => {
  // Production repro: Google was north_star; upserting { name, notes } cleared the tier.
  const created = await mcpCall("upsert_target_company", {
    name: "Google",
    tier: "north_star",
    priority: 1,
    domain: "google.com",
    status: "active",
    notes: "Initial",
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.result.isError, undefined);
  const before = created.body.result.structuredContent.company;
  assert.equal(before.tier, "north_star");
  assert.equal(before.northStar, true);
  assert.equal(before.priority, 1);
  assert.equal(before.domain, "google.com");
  assert.equal(before.status, "active");

  const notesOnly = await mcpCall("upsert_target_company", {
    name: "Google",
    notes: "Role: eng leader. Link: careers.google.com. Why it fits: platform. Gaps: warm intro. Next step: referrer.",
  });
  assert.equal(notesOnly.status, 200);
  assert.equal(notesOnly.body.result.isError, undefined);
  const afterNotes = notesOnly.body.result.structuredContent.company;
  assert.equal(afterNotes.tier, "north_star");
  assert.equal(afterNotes.northStar, true);
  assert.equal(afterNotes.priority, 1);
  assert.equal(afterNotes.domain, "google.com");
  assert.equal(afterNotes.status, "active");
  assert.match(afterNotes.notes, /Why it fits/);

  // Same contract field-by-field: each omitted field must survive a partial upsert.
  const priorityOnly = await mcpCall("upsert_target_company", { name: "Google", priority: 2 });
  assert.equal(priorityOnly.body.result.structuredContent.company.tier, "north_star");
  assert.equal(priorityOnly.body.result.structuredContent.company.northStar, true);
  assert.equal(priorityOnly.body.result.structuredContent.company.priority, 2);
  assert.equal(priorityOnly.body.result.structuredContent.company.domain, "google.com");
  assert.equal(priorityOnly.body.result.structuredContent.company.status, "active");

  const domainOnly = await mcpCall("upsert_target_company", { name: "Google", domain: "abc.xyz" });
  assert.equal(domainOnly.body.result.structuredContent.company.tier, "north_star");
  assert.equal(domainOnly.body.result.structuredContent.company.priority, 2);
  assert.equal(domainOnly.body.result.structuredContent.company.domain, "abc.xyz");
  assert.equal(domainOnly.body.result.structuredContent.company.status, "active");

  const statusOnly = await mcpCall("upsert_target_company", { name: "Google", status: "dropped" });
  assert.equal(statusOnly.body.result.structuredContent.company.tier, "north_star");
  assert.equal(statusOnly.body.result.structuredContent.company.priority, 2);
  assert.equal(statusOnly.body.result.structuredContent.company.domain, "abc.xyz");
  assert.equal(statusOnly.body.result.structuredContent.company.status, "dropped");
});

test("upsert_lead_person stores githubUrl and list returns it", async () => {
  await mcpCall("upsert_target_company", { name: "GitHub Co", tier: "wave_1" });
  const person = await mcpCall("upsert_lead_person", {
    personName: "Dev Example",
    companyName: "GitHub Co",
    contactType: "hiring_leader",
    linkedInUrl: "https://www.linkedin.com/in/dev-example",
    githubUrl: "https://github.com/dev-example",
  });
  assert.equal(person.status, 200);
  assert.equal(person.body.result.isError, undefined);
  assert.equal(person.body.result.structuredContent.lead.githubUrl, "https://github.com/dev-example");
  assert.equal(person.body.result.structuredContent.lead.linkedInUrl, "https://www.linkedin.com/in/dev-example");
  const listed = await mcpCall("list_target_companies", {});
  const row = listed.body.result.structuredContent.companies.find((c) => c.company.name === "GitHub Co");
  assert.ok(row);
  assert.equal(row.people[0].githubUrl, "https://github.com/dev-example");
  const thread = fs.readFileSync(path.join(__dirname, "..", "src/renderer/messages-thread.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "src/renderer/index.html"), "utf8");
  assert.match(html, /data-messages-links/);
  assert.match(thread, /githubUrl/);
  assert.match(thread, /LinkedIn/);
  assert.match(thread, /GitHub/);
});

test("upsert_lead_person stores postingUrl for header job/interview link", async () => {
  await mcpCall("upsert_target_company", { name: "Posting Co", tier: "wave_1" });
  const person = await mcpCall("upsert_lead_person", {
    personName: "Interview Lead",
    companyName: "Posting Co",
    contactType: "recruiter",
    postingUrl: "https://air.usebraintrust.com/i/379/8200",
  });
  assert.equal(person.status, 200);
  assert.equal(person.body.result.isError, undefined);
  assert.equal(
    person.body.result.structuredContent.lead.postingUrl,
    "https://air.usebraintrust.com/i/379/8200"
  );
  const listed = await mcpCall("list_target_companies", {});
  const row = listed.body.result.structuredContent.companies.find((c) => c.company.name === "Posting Co");
  assert.ok(row);
  assert.equal(row.people[0].postingUrl, "https://air.usebraintrust.com/i/379/8200");
  const mcpSrc = fs.readFileSync(path.join(__dirname, "..", "api/mcp.js"), "utf8");
  assert.match(mcpSrc, /postingUrl:\s*\{\s*type:\s*"string"/);
  assert.match(mcpSrc, /if \(args\.postingUrl != null\) patch\.postingUrl/);
});

test("upsert_lead_person does not wipe an existing company north_star tier", async () => {
  await mcpCall("upsert_target_company", {
    name: "Anthropic",
    tier: "north_star",
    priority: 1,
    notes: "Keep this",
  });
  const person = await mcpCall("upsert_lead_person", {
    personName: "Alex Rivera",
    companyName: "Anthropic",
    contactType: "referrer",
    nextStep: "Intro",
    dueDate: "2026-10-14",
  });
  assert.equal(person.status, 200);
  assert.equal(person.body.result.isError, undefined);
  const company = person.body.result.structuredContent.company;
  assert.equal(company.tier, "north_star");
  assert.equal(company.northStar, true);
  assert.equal(company.priority, 1);
  assert.equal(company.notes, "Keep this");
});

test("email/nextStep upsert keeps person notes; mark_lead_done appends marker", async () => {
  const notes = [
    "### What do you want them to understand?",
    "Take a chance",
    "",
    "### __done__",
    "",
  ].join("\n");
  const created = await mcpCall("upsert_lead_person", {
    personName: "Hamid Dadkhah",
    companyName: "Ramp",
    contactType: "hiring_leader",
    notes,
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.result.isError, undefined);
  assert.match(created.body.result.structuredContent.lead.notes, /__done__/);

  const emailed = await mcpCall("upsert_lead_person", {
    personName: "Hamid Dadkhah",
    companyName: "Ramp",
    contactType: "hiring_leader",
    email: "hdadkhah@ramp.com",
    nextStep: "Send the intro email about making reliability second nature",
  });
  assert.equal(emailed.status, 200);
  assert.equal(emailed.body.result.isError, undefined);
  assert.equal(emailed.body.result.structuredContent.lead.email, "hdadkhah@ramp.com");
  assert.match(emailed.body.result.structuredContent.lead.notes, /Take a chance/);
  assert.match(emailed.body.result.structuredContent.lead.notes, /__done__/);

  // Strip marker via store-level path is blocked by merge; mark_lead_done is idempotent.
  const marked = await mcpCall("mark_lead_done", {
    personName: "Hamid Dadkhah",
    companyName: "Ramp",
  });
  assert.equal(marked.status, 200);
  assert.equal(marked.body.result.isError, undefined);
  assert.equal((marked.body.result.structuredContent.lead.notes.match(/__done__/g) || []).length, 1);
});

test("shell is people-list rail and demos omit GTM", () => {
  const shell = fs.readFileSync(path.join(__dirname, "..", "src/renderer/messages-shell.js"), "utf8");
  assert.match(shell, /selectLead/);
  assert.match(shell, /selectYou/);
  assert.match(shell, /rankInboxItems/);
  assert.match(shell, /rankReason/);
  assert.equal(/renderPersonTabs/.test(shell), false);
  const demo = fs.readFileSync(path.join(__dirname, "..", "src/renderer/messages/demo-you.html"), "utf8");
  assert.equal(/Your GTM approach/i.test(demo), false);
  assert.match(demo, /sitting here at home/);
  assert.match(demo, /Tyler Lindow/);
});
