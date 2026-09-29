/* TYL-54 selling parts. Postgres is stubbed. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-selling-parts";
process.env.STYTCH_SECRET = "secret-test-not-real";

let seq = 0;
const tables = {};
function model() {
  const rows = [];
  return {
    rows,
    async create({ data }) {
      const clash = (data.draftKey && rows.some((row) => row.userId === data.userId && row.draftKey === data.draftKey))
        || (data.kind && rows.some((row) => row.userId === data.userId && row.kind === data.kind));
      if (clash) throw Object.assign(new Error("unique"), { code: "P2002" });
      const now = new Date(Date.UTC(2026, 8, 29, 0, 0, ++seq));
      const row = Object.assign({ id: "row_" + seq, createdAt: now, updatedAt: now }, data);
      rows.push(row);
      return row;
    },
    async findUnique({ where }) {
      if (where.id) return rows.find((row) => row.id === where.id) || null;
      const pair = where.userId_draftKey || where.userId_kind;
      if (!pair) return null;
      if (where.userId_draftKey) return rows.find((row) => row.userId === pair.userId && row.draftKey === pair.draftKey) || null;
      return rows.find((row) => row.userId === pair.userId && row.kind === pair.kind) || null;
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
for (const name of ["sellingPart", "sellingPartEvent", "tinkerUserData", "contentItem"]) tables[name] = model();
const database = {
  $executeRawUnsafe: async () => 0, $transaction: async (fn) => fn(database),
  sellingPart: tables.sellingPart, sellingPartEvent: tables.sellingPartEvent,
  tinkerUserData: tables.tinkerUserData, contentItem: tables.contentItem,
};
function stubAt(absPath, exports) {
  const mod = new Module(absPath);
  mod.filename = absPath;
  mod.loaded = true;
  mod.exports = exports;
  require.cache[absPath] = mod;
}
const libDir = path.resolve(__dirname, "..", "api", "_lib");
stubAt(path.join(libDir, "stytch.js"), {
  authenticateSession: async (token) => {
    if (token !== "user-a" && token !== "user-b") throw Object.assign(new Error("nope"), { status: 401 });
    const email = token === "user-a" ? "tyler@example.com" : "other@example.com";
    return { session: { user_id: token }, user: { user_id: token, emails: [{ email }] } };
  },
});
stubAt(path.join(libDir, "db.js"), database);
const store = require("../api/_lib/selling-parts-store.js");
const handler = require("../api/selling-parts.js");

async function call({ method, token = "user-a", action, body, query }) {
  const captured = { status: null, body: null };
  await handler({
    method,
    url: "/api/selling-parts",
    headers: { authorization: token ? "Bearer " + token : "" },
    body,
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

test("migration matches and messaging is gone", () => {
  const root = path.join(__dirname, "..");
  const migration = fs.readFileSync(path.join(root, "prisma/migrations/20260929040000_add_selling_parts/migration.sql"), "utf8");
  for (const statement of store.TABLE_STATEMENTS) assert.ok(migration.includes(statement));
  assert.equal(fs.existsSync(path.join(root, "prisma/migrations/20260929020000_add_messaging")), false);
  const schema = fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8");
  assert.ok(schema.includes("model SellingPart"));
  assert.ok(schema.includes("model SellingPartEvent"));
  assert.equal(schema.includes("model Messaging"), false);
  const source = fs.readFileSync(path.join(libDir, "selling-parts-store.js"), "utf8")
    + fs.readFileSync(path.join(root, "api/selling-parts.js"), "utf8") + migration + schema;
  for (const word of ["MessagingContact", "doNotContact", "pending_approval", "apollo", "sendgrid", "sourceChanged", "selling-stages", "tyler:"]) {
    assert.equal(source.includes(word), false, word);
  }
  assert.equal(migration.includes("draftKey"), false);
  assert.equal(fs.readFileSync(path.join(libDir, "selling-parts-store.js"), "utf8").includes("draftKey"), false);
  const emails = fs.readFileSync(__filename, "utf8").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  assert.ok(emails.length > 0 && emails.every((email) => email.endsWith("@example.com")));
});

test("stages are a fixed list", async () => {
  const first = await call({ method: "GET", action: "stages" });
  assert.deepEqual(first.body.stages.map((stage) => stage.key), store.STAGES.map((stage) => stage.key));
  assert.match(first.body.stages[0].description, /curious/);
  assert.doesNotMatch(first.body.stages[2].description, /Tyler|nanoengineering/);
  assert.equal(tables.tinkerUserData.rows.length, 0);
  assert.equal((await call({ method: "POST", action: "stages", body: { stages: [] } })).status, 400);
  const created = await call({ method: "POST", action: "create", body: { stageKey: "ask", title: "The ask", body: "Fifteen minutes.", topics: ["intro"], sourceKind: "none" } });
  assert.equal(created.status, 201);
  const read = await call({ method: "GET", action: "part", query: { id: created.body.part.id } });
  assert.equal(read.body.part.title, "The ask");
  assert.equal(read.body.part.stageKey, "ask");
});

test("a note becomes a part, edits demote ready, and another user gets 404", async () => {
  const created = await call({
    method: "POST",
    action: "create",
    body: {
      stageKey: "hook", title: "Curious line", body: "A short hook.", topics: ["fintech", "developers"],
      sourceKind: "note", sourceId: "note-1", sourceExcerpt: "The whole note stays", sourceHash: "abc123",
      fields: { start: "no", number: "1", cause: "no" },
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.part.status, "draft");
  assert.equal(created.body.part.sourceExcerpt, "The whole note stays");
  assert.equal(created.body.part.sourceHash, "abc123");
  assert.equal(created.body.part.body, "A short hook.");
  const id = created.body.part.id;
  const listed = await call({ method: "GET", action: "list", query: { stage: "hook", topic: "fintech", sourceKind: "note" } });
  assert.deepEqual(listed.body.parts.map((part) => part.id), [id]);
  const ready = await call({ method: "POST", action: "status", body: { id, status: "ready" } });
  assert.equal(ready.body.part.status, "ready");
  assert.equal(ready.body.event.actor, "user:tyler@example.com");
  assert.match(ready.body.event.at, /^\d{4}-\d{2}-\d{2}T/);
  const edited = await call({ method: "PATCH", action: "edit", body: { id, body: "A tighter hook." } });
  assert.equal(edited.body.part.status, "draft");
  assert.equal(edited.body.part.body, "A tighter hook.");
  const actions = tables.sellingPartEvent.rows.map((row) => row.action);
  assert.deepEqual(actions, ["created", "ready", "edited"]);
  for (const row of tables.sellingPartEvent.rows) {
    assert.equal(row.actor, "user:tyler@example.com"); assert.ok(row.at instanceof Date);
  }
  assert.equal((await call({ method: "GET", token: "user-b", action: "part", query: { id } })).status, 404);
  assert.deepEqual((await call({ method: "GET", token: "user-b", action: "list" })).body.parts, []);
  assert.equal((await call({ method: "POST", token: "mcp_test_key", action: "status", body: { id, status: "ready" } })).status, 401);
  const code = await call({ method: "POST", action: "create", body: { stageKey: "proof_point", title: "The store", body: "Tables.", sourceKind: "code", stack: ["TypeScript", "Prisma", "MCP"], concepts: ["Idempotency", "event_driven"], sourceRef: { repo: "example/widget", path: "api/store.js", ref: "12", evidence: ["api/store.js", "api/keys.js"] } } });
  assert.equal(code.status, 201);
  assert.deepEqual(code.body.part.stack, ["typescript", "prisma", "mcp"]);
  assert.deepEqual(code.body.part.concepts, ["idempotency", "event-driven"]);
  assert.deepEqual(code.body.part.sourceRef, { repo: "example/widget", path: "api/store.js", ref: "12", evidence: ["api/store.js", "api/keys.js"] });
  const found = await call({ method: "GET", action: "list", query: { stack: "not-a-stack", concepts: "Event Driven", sourceKind: "code" } });
  assert.deepEqual(found.body.parts.map((part) => part.id), [code.body.part.id]);
});
