/* list_essays + read_essay: owner Founder Source / Development essays. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-essays-mcp";
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
  "essays-mcp.js",
  "repo-folders-store.js",
  "repo-folders-core.js",
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

const essaysLib = require("../api/_lib/essays-mcp.js");
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

function seedEssays(userId, rows) {
  tables.tinkerUserData.rows.push({
    id: "essays_" + userId,
    userId,
    kind: "essays",
    data: rows,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

test.beforeEach(() => {
  seq = 0;
  tables.tinkerUserData.rows.length = 0;
});

test("list_essays and read_essay are listed as read-only", async () => {
  const listed = fakeRes();
  await mcp({
    method: "POST",
    headers: { authorization: "Bearer " + BOT_A },
    body: { jsonrpc: "2.0", id: 9, method: "tools/list" },
  }, listed);
  const names = listed.captured.body.result.tools.map((t) => t.name);
  assert.ok(names.includes("list_essays"));
  assert.ok(names.includes("read_essay"));
  const listTool = listed.captured.body.result.tools.find((t) => t.name === "list_essays");
  const readTool = listed.captured.body.result.tools.find((t) => t.name === "read_essay");
  assert.equal(listTool.annotations.readOnlyHint, true);
  assert.equal(readTool.annotations.readOnlyHint, true);
  assert.deepEqual(Object.keys(listTool.inputSchema.properties).sort(), ["limit", "side"]);
  assert.deepEqual(listTool.inputSchema.properties.side.enum, ["business", "technical"]);
  assert.deepEqual(readTool.inputSchema.required, ["id"]);
  assert.match(listTool.description, /Founder Source/);
  assert.match(listTool.description, /Development/);
  assert.equal(/—/.test(listTool.description), false);
  assert.equal(/—/.test(readTool.description), false);
});

test("list_essays returns owner essays with Title Case title, side labels, wordCount; cross-owner safe", async () => {
  seedEssays("user-a", [
    {
      id: "e_founder",
      title: "everyone is a founder",
      body: "You already ship. Keep going one more step.",
      contentType: "business",
      createdAt: Date.parse("2026-09-28T12:00:00.000Z"),
      updatedAt: Date.parse("2026-09-30T18:00:00.000Z"),
    },
    {
      id: "e_coach",
      title: "You are the coach for you",
      body: "Write the next sentence before you ask for help.",
      contentType: "stories",
      createdAt: Date.parse("2026-09-29T12:00:00.000Z"),
      updatedAt: Date.parse("2026-09-29T15:00:00.000Z"),
    },
    {
      id: "e_tech",
      title: "VC rhetoric and shipping",
      body: "Prefer a working file over a slide.",
      contentType: "technical",
      createdAt: Date.parse("2026-09-27T12:00:00.000Z"),
      updatedAt: Date.parse("2026-09-30T20:00:00.000Z"),
    },
    {
      id: "e_empty",
      title: "Empty skip",
      body: "   ",
      contentType: "business",
      updatedAt: Date.parse("2026-09-30T21:00:00.000Z"),
    },
  ]);
  seedEssays("user-b", [
    {
      id: "e_other",
      title: "secret essay",
      body: "Must not leak to user-a",
      contentType: "business",
      updatedAt: Date.parse("2026-09-30T22:00:00.000Z"),
    },
  ]);

  const mine = await mcpCall(BOT_A, "list_essays", { userId: "user-b" });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.result.isError, undefined);
  const rows = mine.body.result.structuredContent.essays;
  assert.ok(Array.isArray(rows));
  const ids = rows.map((r) => r.id);
  assert.deepEqual(ids, ["e_tech", "e_founder", "e_coach"]);
  assert.equal(ids.includes("e_empty"), false);
  assert.equal(ids.includes("e_other"), false);

  const founder = rows.find((r) => r.id === "e_founder");
  assert.equal(founder.title, "Everyone is a Founder");
  assert.equal(founder.storedTitle, "everyone is a founder");
  assert.equal(founder.side, "Founder Source");
  assert.equal(founder.wordCount, 8);

  const coach = rows.find((r) => r.id === "e_coach");
  assert.equal(coach.side, "Founder Source");
  assert.equal(coach.title, "You Are the Coach for You");

  const tech = rows.find((r) => r.id === "e_tech");
  assert.equal(tech.side, "Development");
  assert.equal(tech.storedTitle, "VC rhetoric and shipping");
  assert.match(tech.title, /^VC Rhetoric/);

  assert.deepEqual(Object.keys(rows[0]).sort(), [
    "createdAt", "id", "side", "storedTitle", "title", "updatedAt", "wordCount",
  ]);
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], "body"), false);

  const theirs = await mcpCall(BOT_B, "list_essays", {});
  const otherIds = theirs.body.result.structuredContent.essays.map((r) => r.id);
  assert.deepEqual(otherIds, ["e_other"]);
  assert.equal(otherIds.includes("e_founder"), false);
});

test("list_essays filters by side and limit", async () => {
  seedEssays("user-a", [
    {
      id: "e1",
      title: "biz one",
      body: "one two three",
      contentType: "business",
      updatedAt: Date.parse("2026-09-30T18:00:00.000Z"),
    },
    {
      id: "e2",
      title: "tech one",
      body: "alpha beta",
      contentType: "technical",
      updatedAt: Date.parse("2026-09-30T19:00:00.000Z"),
    },
    {
      id: "e3",
      title: "biz two",
      body: "four five",
      contentType: "business",
      updatedAt: Date.parse("2026-09-30T17:00:00.000Z"),
    },
  ]);

  const biz = await mcpCall(BOT_A, "list_essays", { side: "business" });
  assert.deepEqual(
    biz.body.result.structuredContent.essays.map((r) => r.id),
    ["e1", "e3"]
  );
  assert.ok(biz.body.result.structuredContent.essays.every((r) => r.side === "Founder Source"));

  const tech = await mcpCall(BOT_A, "list_essays", { side: "technical", limit: 1 });
  assert.deepEqual(
    tech.body.result.structuredContent.essays.map((r) => r.id),
    ["e2"]
  );
  assert.equal(tech.body.result.structuredContent.essays[0].side, "Development");

  const limited = await essaysLib.listEssays({ userId: "user-a", limit: 1 });
  assert.equal(limited.length, 1);
  assert.equal(limited[0].id, "e2");
});

test("read_essay returns full body for owner; cross-owner and missing fail", async () => {
  seedEssays("user-a", [
    {
      id: "e_founder",
      title: "everyone is a founder",
      body: "Full essay body lives here.",
      contentType: "business",
      createdAt: Date.parse("2026-09-28T12:00:00.000Z"),
      updatedAt: Date.parse("2026-09-30T18:00:00.000Z"),
    },
  ]);
  seedEssays("user-b", [
    {
      id: "e_secret",
      title: "other",
      body: "private to b",
      contentType: "technical",
    },
  ]);

  const ok = await mcpCall(BOT_A, "read_essay", { id: "e_founder", userId: "user-b" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.result.isError, undefined);
  const essay = ok.body.result.structuredContent.essay;
  assert.equal(essay.id, "e_founder");
  assert.equal(essay.title, "Everyone is a Founder");
  assert.equal(essay.storedTitle, "everyone is a founder");
  assert.equal(essay.side, "Founder Source");
  assert.equal(essay.body, "Full essay body lives here.");
  assert.equal(essay.wordCount, 5);

  const leak = await mcpCall(BOT_A, "read_essay", { id: "e_secret" });
  assert.equal(leak.body.result.isError, true);
  assert.match(String(leak.body.result.content[0].text), /not found/i);

  const missing = await mcpCall(BOT_A, "read_essay", { id: "nope" });
  assert.equal(missing.body.result.isError, true);

  const bad = await mcpCall(BOT_A, "read_essay", {});
  assert.equal(bad.body.result.isError, true);
});
