/* list_self_reflections: owner You-thread + typed reflections, cross-owner safe. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-self-reflections";
process.env.STYTCH_SECRET = "secret-test-not-real";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";

let seq = 0;
const tables = {};
function model() {
  const rows = [];
  return {
    rows,
    async create({ data }) {
      if (data.kind && rows.some((r) => r.userId === data.userId && r.kind === data.kind)) {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      }
      const now = new Date(Date.UTC(2026, 8, 30, 12, 0, ++seq));
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
  };
}
tables.tinkerUserData = model();
const database = {
  $executeRawUnsafe: async () => 0,
  $transaction: async (fn) => fn(database),
  tinkerUserData: tables.tinkerUserData,
};

function stubAt(absPath, exports) {
  const mod = new Module(absPath);
  mod.filename = absPath;
  mod.loaded = true;
  mod.exports = exports;
  require.cache[absPath] = mod;
}
const libDir = path.resolve(__dirname, "..", "api", "_lib");
const apiDir = path.resolve(__dirname, "..", "api");
for (const rel of [
  "self-thread-store.js",
  "self-reflections.js",
  "db.js",
  "stytch.js",
  "mcp-keys.js",
]) {
  delete require.cache[path.join(libDir, rel)];
}
delete require.cache[path.join(apiDir, "mcp.js")];

stubAt(path.join(libDir, "stytch.js"), {
  authenticateSession: async () => {
    throw Object.assign(new Error("nope"), { status: 401 });
  },
});
stubAt(path.join(libDir, "db.js"), database);
stubAt(path.join(libDir, "mcp-keys.js"), {
  isMcpApiKey: (t) => typeof t === "string" && t.startsWith("mcp_"),
  authenticateMcpKey: async (token) => {
    if (token === "mcp_" + "a".repeat(43)) return { id: "k1", label: "bot", userId: "user-a" };
    if (token === "mcp_" + "b".repeat(43)) return { id: "k2", label: "other", userId: "user-b" };
    throw Object.assign(new Error("Invalid API key."), { status: 401 });
  },
  userIdFromSession: () => "",
});

const store = require("../api/_lib/self-thread-store.js");
const reflections = require("../api/_lib/self-reflections.js");
const mcp = require("../api/mcp.js");

const BOT_A = "mcp_" + "a".repeat(43);
const BOT_B = "mcp_" + "b".repeat(43);

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
async function mcpCall(token, name, args) {
  const res = fakeRes();
  await mcp({
    method: "POST",
    url: "/api/mcp",
    headers: { authorization: "Bearer " + token },
    body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } },
  }, res);
  return res.captured;
}

test.beforeEach(() => {
  seq = 0;
  tables.tinkerUserData.rows.length = 0;
});

test("list_self_reflections is listed as read-only with since and limit", async () => {
  const listed = fakeRes();
  await mcp({
    method: "POST",
    headers: { authorization: "Bearer " + BOT_A },
    body: { jsonrpc: "2.0", id: 9, method: "tools/list" },
  }, listed);
  const names = listed.captured.body.result.tools.map((t) => t.name);
  assert.ok(names.includes("list_self_reflections"));
  const tool = listed.captured.body.result.tools.find((t) => t.name === "list_self_reflections");
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ["limit", "since"]);
  assert.match(tool.description, /newest first/i);
  assert.match(tool.description, /Read-only/i);
  assert.equal(/—/.test(tool.description), false);
});

test("list_self_reflections returns owner-typed essays and bot posts; cross-owner is empty", async () => {
  await store.postMessage({
    userId: "user-a",
    title: "Bot note",
    body: "Assistant drop-in",
    source: "mcp",
  });
  await store.postMessage({
    userId: "user-a",
    title: "Owner note",
    body: "I typed this myself",
    source: "owner",
  });
  await store.postMessage({
    userId: "user-b",
    title: "Other owner",
    body: "Secret to user-b only",
    source: "owner",
  });

  tables.tinkerUserData.rows.push({
    id: "essay_a",
    userId: "user-a",
    kind: "essays",
    data: [{
      id: "e_tyler1",
      title: "What I learned today",
      body: "I am choosing trust over speed.",
      createdAt: Date.parse("2026-09-30T18:00:00.000Z"),
      updatedAt: Date.parse("2026-09-30T19:00:00.000Z"),
    }],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  tables.tinkerUserData.rows.push({
    id: "draft_a",
    userId: "user-a",
    kind: "drafts",
    data: [{
      id: "d_wip1",
      title: "WIP reflection",
      transcript: [{ q: "What are you learning?", a: "How to ask for help." }],
      updatedAt: Date.parse("2026-09-30T20:00:00.000Z"),
      createdAt: Date.parse("2026-09-30T17:00:00.000Z"),
    }],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  tables.tinkerUserData.rows.push({
    id: "essay_b",
    userId: "user-b",
    kind: "essays",
    data: [{
      id: "e_other",
      title: "Other essay",
      body: "Must not leak",
      createdAt: Date.parse("2026-09-30T21:00:00.000Z"),
    }],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const mine = await mcpCall(BOT_A, "list_self_reflections", { userId: "user-b" });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.result.isError, undefined);
  const rows = mine.body.result.structuredContent.reflections;
  assert.ok(Array.isArray(rows));
  const ids = rows.map((r) => r.id);
  assert.ok(ids.includes("e_tyler1"));
  assert.ok(ids.includes("d_wip1"));
  assert.ok(rows.some((r) => r.title === "Owner note" && /typed this myself/.test(r.body)));
  assert.ok(rows.some((r) => r.title === "Bot note"));
  assert.equal(ids.includes("e_other"), false);
  assert.equal(rows.some((r) => /Must not leak|Secret to user-b/.test(r.body)), false);
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    "body", "contentType", "createdAt", "folderId", "id", "title", "updatedAt",
  ]);
  assert.equal(rows[0].contentType, "stories");
  assert.equal(rows[0].folderId, null);
  // Newest first by updatedAt
  for (let i = 1; i < rows.length; i++) {
    const prev = Date.parse(rows[i - 1].updatedAt);
    const cur = Date.parse(rows[i].updatedAt);
    assert.ok(prev >= cur);
  }

  const theirs = await mcpCall(BOT_B, "list_self_reflections", {});
  assert.equal(theirs.status, 200);
  const otherIds = theirs.body.result.structuredContent.reflections.map((r) => r.id);
  assert.ok(otherIds.includes("e_other"));
  assert.equal(otherIds.includes("e_tyler1"), false);
  assert.equal(otherIds.includes("d_wip1"), false);
  assert.equal(otherIds.some((id) => String(id).startsWith("self_") && ids.includes(id)), false);
});

test("list_self_reflections honors since and limit", async () => {
  tables.tinkerUserData.rows.push({
    id: "essay_a2",
    userId: "user-a",
    kind: "essays",
    data: [
      {
        id: "e_old",
        title: "Old",
        body: "Yesterday",
        createdAt: Date.parse("2026-09-01T00:00:00.000Z"),
        updatedAt: Date.parse("2026-09-01T00:00:00.000Z"),
      },
      {
        id: "e_new",
        title: "New",
        body: "Today",
        createdAt: Date.parse("2026-09-30T12:00:00.000Z"),
        updatedAt: Date.parse("2026-09-30T15:00:00.000Z"),
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const sinceOnly = await reflections.listSelfReflections({
    userId: "user-a",
    since: "2026-09-30T00:00:00.000Z",
  });
  assert.deepEqual(sinceOnly.map((r) => r.id), ["e_new"]);

  const limited = await reflections.listSelfReflections({
    userId: "user-a",
    limit: 1,
  });
  assert.equal(limited.length, 1);
  assert.equal(limited[0].id, "e_new");
});
