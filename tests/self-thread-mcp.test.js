/* TYL-65: MCP post_to_self_thread delivers into the owner's You thread. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const fs = require("node:fs");

process.env.STYTCH_PROJECT_ID = "project-test-self-thread";
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
      const now = new Date(Date.UTC(2026, 8, 29, 3, 0, ++seq));
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
for (const rel of ["self-thread-store.js", "db.js", "stytch.js", "mcp-keys.js"]) {
  delete require.cache[path.join(libDir, rel)];
}
delete require.cache[path.join(apiDir, "self-thread.js")];
delete require.cache[path.join(apiDir, "mcp.js")];

stubAt(path.join(libDir, "stytch.js"), {
  authenticateSession: async (token) => {
    if (token !== "user-a" && token !== "user-b") throw Object.assign(new Error("nope"), { status: 401 });
    return { session: { user_id: token }, user: { user_id: token, emails: [{ email: token + "@example.com" }] } };
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
  userIdFromSession: (s) => (s && s.session && s.session.user_id) || "",
});

const store = require("../api/_lib/self-thread-store.js");
const owner = require("../api/self-thread.js");
const mcp = require("../api/mcp.js");

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
async function ownerCall({ method, token = "user-a", action, body }) {
  const res = fakeRes();
  await owner({
    method, url: "/api/self-thread",
    headers: { authorization: "Bearer " + token },
    body, query: { action },
  }, res);
  return res.captured;
}
async function mcpCall(token, name, args) {
  const res = fakeRes();
  await mcp({
    method: "POST", url: "/api/mcp",
    headers: { authorization: "Bearer " + token },
    body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } },
  }, res);
  return res.captured;
}

test.beforeEach(() => {
  seq = 0;
  tables.tinkerUserData.rows.length = 0;
});

test("post_to_self_thread is listed and posts only into the connector user's thread", async () => {
  const listed = fakeRes();
  await mcp({
    method: "POST",
    headers: { authorization: "Bearer " + "mcp_" + "a".repeat(43) },
    body: { jsonrpc: "2.0", id: 9, method: "tools/list" },
  }, listed);
  const names = listed.captured.body.result.tools.map((t) => t.name);
  assert.ok(names.includes("post_to_self_thread"));
  const tool = listed.captured.body.result.tools.find((t) => t.name === "post_to_self_thread");
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ["body", "title"]);
  assert.deepEqual(tool.inputSchema.required, ["title", "body"]);
  assert.match(tool.description, /You inbox thread/i);
  assert.match(tool.description, /Does not send/i);
  assert.equal(/—/.test(tool.description), false);

  const bot = "mcp_" + "a".repeat(43);
  const other = "mcp_" + "b".repeat(43);
  const posted = await mcpCall(bot, "post_to_self_thread", {
    title: "Quick note",
    body: "## Focus\n- Hire through trust\n- Keep the note short",
    userId: "user-b",
  });
  assert.equal(posted.status, 200);
  assert.equal(posted.body.result.isError, undefined);
  const message = posted.body.result.structuredContent.message;
  assert.equal(message.title, "Quick note");
  assert.match(message.body, /Hire through trust/);
  assert.equal(message.source, "mcp");
  assert.match(message.id, /^self_/);

  const mine = await ownerCall({ method: "GET", action: "list" });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.messages.length, 1);
  assert.equal(mine.body.messages[0].id, message.id);

  const theirs = await ownerCall({ method: "GET", token: "user-b", action: "list" });
  assert.equal(theirs.body.messages.length, 0);

  const otherPost = await mcpCall(other, "post_to_self_thread", {
    title: "Other only",
    body: "Should not appear for user-a",
  });
  assert.equal(otherPost.status, 200);
  assert.equal((await ownerCall({ method: "GET", action: "list" })).body.messages.length, 1);
  assert.equal((await ownerCall({ method: "GET", token: "user-b", action: "list" })).body.messages.length, 1);

  assert.ok(names.includes("set_company_priority"));
  assert.ok(names.includes("plan_lead_touch"));
  assert.match(tool.description, /short message|brief assistant/i);
  assert.equal(/GTM approach/.test(tool.description), false);
});

test("listMessages and purge_plan hard-delete legacy GTM approach dumps", async () => {
  // Bypass postMessage rejection by writing the blob directly.
  const blob = {
    messages: [
      {
        id: "self_gtm1",
        title: "Your GTM approach (Sep 29)",
        body: "TLDR\nNorth Star: Google\nWave 1: Alloy",
        createdAt: new Date().toISOString(),
        source: "mcp",
      },
      {
        id: "self_keep",
        title: "Keep this",
        body: "Short assistant note",
        createdAt: new Date().toISOString(),
        source: "mcp",
      },
    ],
  };
  tables.tinkerUserData.rows.push({
    id: "row_gtm",
    userId: "user-a",
    kind: "self_thread",
    data: blob,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const purged = await store.purgePlanMessages({ userId: "user-a" });
  assert.equal(purged.removed, 1);
  const listed = await store.listMessages({ userId: "user-a" });
  assert.equal(listed.length, 1);
  assert.equal(listed[0].title, "Keep this");
  await assert.rejects(
    () => store.postMessage({ userId: "user-a", title: "GTM approach", body: "Nope" }),
    /Do not post GTM/,
  );
});

test("owner API rejects empty posts; You writing no longer mounts story cards", async () => {
  const bad = await ownerCall({ method: "POST", action: "post", body: { title: "", body: "x" } });
  assert.equal(bad.status, 400);
  const you = fs.readFileSync(path.join(__dirname, "..", "src/renderer/messages-you.js"), "utf8");
  // Self-thread API remains for MCP / data; UI cards are gone.
  assert.match(you, /\/api\/self-thread|loadSelfPosts/);
  assert.doesNotMatch(you, /host\.appendChild\(renderSelfPosts/);
  assert.match(you, /Stories live on \/repo|Do not render story cards/);
  // Header uses profile name (Tyler Lindow), not a hard-coded brand label.
  assert.match(you, /ownerProfile/);
  assert.equal(/shell\.OWNER_LABEL/.test(you), false);
  assert.equal(/—/.test(you), false);
});

test("store helpers trim and cap fields", async () => {
  await assert.rejects(() => store.postMessage({ userId: "user-a", title: "t", body: "" }), /body is required/);
  const ok = await store.postMessage({
    userId: "user-a",
    title: "  Note  ",
    body: "Hello **world**",
  });
  assert.equal(ok.title, "Note");
  assert.equal(ok.body, "Hello **world**");
});
