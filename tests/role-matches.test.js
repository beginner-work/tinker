/* Role matches store + MCP tools for the overview Roles section. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-roles";
process.env.STYTCH_SECRET = "secret-test-not-real";
process.env.ANTHROPIC_API_KEY = "";

let seq = 0;
const rows = [];
const database = {
  $executeRawUnsafe: async () => 0,
  $transaction: async (fn) => fn(database),
  tinkerUserData: {
    async create({ data }) {
      const now = new Date(Date.UTC(2026, 9, 2, 12, 0, ++seq));
      const row = Object.assign({ id: "row_" + seq, createdAt: now, updatedAt: now }, data);
      rows.push(row);
      return row;
    },
    async findUnique({ where }) {
      const pair = where.userId_kind;
      if (!pair) return null;
      return rows.find((r) => r.userId === pair.userId && r.kind === pair.kind) || null;
    },
    async upsert({ where, create, update }) {
      const pair = where.userId_kind;
      const row = rows.find((r) => r.userId === pair.userId && r.kind === pair.kind);
      if (!row) return this.create({ data: create });
      Object.assign(row, update, { updatedAt: new Date() });
      return row;
    },
  },
};

function stubAt(absPath, exports) {
  const mod = new Module(absPath);
  mod.filename = absPath;
  mod.loaded = true;
  mod.exports = exports;
  require.cache[absPath] = mod;
}

const libDir = path.resolve(__dirname, "..", "api", "_lib");
delete require.cache[path.join(libDir, "role-matches-store.js")];
delete require.cache[path.join(libDir, "db.js")];
stubAt(path.join(libDir, "db.js"), database);

const store = require(path.join(libDir, "role-matches-store.js"));

test("save_role_match upserts by postingUrl and list omits dismissed", async () => {
  const a = await store.saveRoleMatch({
    userId: "user-a",
    company: "Stripe",
    title: "EM, Merchant Onboarding",
    postingUrl: "https://stripe.com/jobs/em-onboarding",
    location: "Remote (West Coast)",
    fitReason: "KYB / identity / merchant platforms",
  });
  assert.equal(a.company, "Stripe");
  assert.equal(a.title, "EM, Merchant Onboarding");
  assert.ok(a.savedAt);

  const b = await store.saveRoleMatch({
    userId: "user-a",
    company: "Stripe",
    title: "Engineering Manager, Onboarding",
    postingUrl: "https://stripe.com/jobs/em-onboarding/",
    location: "San Francisco",
    fitReason: "Payments merchant platform",
  });
  assert.equal(b.id, a.id);
  assert.equal(b.title, "Engineering Manager, Onboarding");

  let listed = await store.listRoleMatches({ userId: "user-a" });
  assert.equal(listed.length, 1);

  await store.dismissRoleMatch({ userId: "user-a", roleId: a.id });
  listed = await store.listRoleMatches({ userId: "user-a" });
  assert.equal(listed.length, 0);

  const revived = await store.saveRoleMatch({
    userId: "user-a",
    company: "Stripe",
    title: "EM, Merchant Onboarding",
    postingUrl: "https://stripe.com/jobs/em-onboarding",
    location: "Remote",
    fitReason: "Fit",
  });
  assert.equal(revived.id, a.id);
  assert.equal(revived.dismissedAt, null);
  listed = await store.listRoleMatches({ userId: "user-a" });
  assert.equal(listed.length, 1);
});

test("role matches are separate from job applications kind", () => {
  assert.equal(store.KIND, "role_matches");
  assert.notEqual(store.KIND, "job_applications");
});
