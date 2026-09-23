/* Durable MCP API keys: mint stores a hash only, /api/mcp accepts a
 * live key, rejects a revoked or garbage key, and still accepts a
 * Stytch session. Stytch and Postgres are stubbed.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-mcp-keys";
process.env.STYTCH_SECRET = "secret-test-not-real";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
process.env.MCP_KEY_OWNER_USER_ID = "user-owner";

const stytchCalls = [];
const creates = [];
const updates = [];
const findUniques = [];
const sql = [];
let stytchUserId = "user-owner";
let stytchShouldThrow = null;
let storeShouldThrow = null;
const rows = [];

const stytchStub = {
  authenticateSession: async (token) => {
    stytchCalls.push(token);
    if (stytchShouldThrow) throw stytchShouldThrow;
    if (!token) throw Object.assign(new Error("Missing token."), { status: 401 });
    if (token === "good-token" || token === "good.jwt.token") {
      return { session: { user_id: stytchUserId }, user: { user_id: stytchUserId } };
    }
    throw Object.assign(new Error("Session expired."), { status: 401 });
  },
};

const dbStub = {
  $executeRawUnsafe: async (statement) => {
    sql.push(statement);
    return 0;
  },
  mcpApiKey: {
    create: async ({ data }) => {
      creates.push(data);
      if (storeShouldThrow) throw storeShouldThrow;
      const row = {
        id: `key_${rows.length + 1}`,
        keyHash: data.keyHash,
        label: data.label,
        createdAt: new Date(Date.UTC(2026, 8, 23, 12, 0, rows.length)),
        revokedAt: null,
      };
      rows.push(row);
      return row;
    },
    findUnique: async ({ where }) => {
      findUniques.push(where);
      if (storeShouldThrow) throw storeShouldThrow;
      if (where.keyHash) return rows.find((row) => row.keyHash === where.keyHash) || null;
      if (where.id) return rows.find((row) => row.id === where.id) || null;
      return null;
    },
    findMany: async () => {
      if (storeShouldThrow) throw storeShouldThrow;
      return rows
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((row) => ({
          id: row.id,
          label: row.label,
          createdAt: row.createdAt,
          revokedAt: row.revokedAt,
        }));
    },
    update: async ({ where, data }) => {
      updates.push({ where, data });
      if (storeShouldThrow) throw storeShouldThrow;
      const row = rows.find((item) => item.id === where.id);
      if (!row) {
        const err = new Error("not found");
        err.code = "P2025";
        throw err;
      }
      if (data.revokedAt) row.revokedAt = data.revokedAt;
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
stubAt(path.join(libDir, "stytch.js"), stytchStub);
stubAt(path.join(libDir, "db.js"), dbStub);

const {
  TABLE_STATEMENTS,
  hashKey,
  resetTableCache,
  mintMcpKey,
} = require("../api/_lib/mcp-keys.js");
const mcp = require("../api/mcp.js");
const keys = require("../api/mcp-keys.js");

function fakeRes() {
  const captured = { status: null, body: undefined, headers: {} };
  return {
    captured,
    statusCode: 200,
    setHeader(name, value) { captured.headers[String(name).toLowerCase()] = value; },
    status(code) { captured.status = code; this.statusCode = code; return this; },
    json(body) { captured.body = body; return this; },
    end() { return this; },
  };
}

function mcpReq({ method = "POST", token, body, headers = {} } = {}) {
  return {
    method,
    url: "/api/mcp",
    headers: {
      authorization: token ? `Bearer ${token}` : "",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body,
  };
}

function keysReq({ method, token = "good-token", body, query } = {}) {
  return {
    method,
    url: "/api/mcp-keys",
    headers: {
      authorization: token ? `Bearer ${token}` : "",
      "content-type": "application/json",
    },
    body,
    query,
  };
}

function reset() {
  stytchCalls.length = 0;
  creates.length = 0;
  updates.length = 0;
  findUniques.length = 0;
  sql.length = 0;
  rows.length = 0;
  stytchUserId = "user-owner";
  stytchShouldThrow = null;
  storeShouldThrow = null;
  process.env.MCP_KEY_OWNER_USER_ID = "user-owner";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
  resetTableCache();
}

test.beforeEach(reset);

test("migration SQL matches the statements the server applies", () => {
  const file = fs.readFileSync(
    path.join(__dirname, "..", "prisma", "migrations", "20260923120000_add_mcp_api_keys", "migration.sql"),
    "utf8",
  );
  for (const statement of TABLE_STATEMENTS) {
    assert.ok(file.includes(statement), statement.slice(0, 40));
  }
  assert.equal(file.includes("\u2014"), false);
});

test("mint stores the hash only and shows the plaintext once", async () => {
  const direct = await mintMcpKey({ label: " clay " });
  assert.match(direct.key, /^mcp_[A-Za-z0-9_-]{43}$/);
  assert.equal(direct.key.includes("."), false);
  assert.deepEqual(Object.keys(creates[0]).sort(), ["keyHash", "label"]);
  assert.equal(creates[0].label, "clay");
  assert.equal(creates[0].keyHash, hashKey(direct.key));
  assert.equal(creates[0].keyHash.includes(direct.key), false);
  assert.equal(JSON.stringify(creates[0]).includes(direct.key), false);
  assert.equal(rows[0].revokedAt, null);
  assert.ok(rows[0].createdAt instanceof Date);
  assert.ok(sql.length >= 1);
  assert.equal(sql.join("\n").includes(direct.key), false);

  reset();
  const res = fakeRes();
  await keys(keysReq({ method: "POST", body: { label: "clay" } }), res);
  assert.equal(res.captured.status, 200);
  assert.match(res.captured.body.key, /^mcp_[A-Za-z0-9_-]{43}$/);
  assert.equal(res.captured.body.note, "Copy this key now. It will not be shown again.");
  assert.equal(res.captured.body.note.includes("\u2014"), false);
  assert.equal(res.captured.body.keyHash, undefined);
  assert.equal(JSON.stringify(res.captured.body).includes(creates[0].keyHash), false);
  assert.equal(creates[0].keyHash, hashKey(res.captured.body.key));

  const listed = fakeRes();
  await keys(keysReq({ method: "GET" }), listed);
  assert.equal(listed.captured.status, 200);
  assert.equal(listed.captured.body.keys.length, 1);
  assert.equal(listed.captured.body.keys[0].id, res.captured.body.id);
  assert.equal(listed.captured.body.keys[0].revokedAt, null);
  assert.equal(JSON.stringify(listed.captured.body).includes(res.captured.body.key), false);
  assert.equal(JSON.stringify(listed.captured.body).includes("keyHash"), false);
});

test("a minted key can list and call tools, and Stytch is not contacted", async () => {
  const minted = fakeRes();
  await keys(keysReq({ method: "POST", body: { label: "clay" } }), minted);
  const key = minted.captured.body.key;
  stytchCalls.length = 0;
  findUniques.length = 0;

  const listed = fakeRes();
  await mcp(mcpReq({
    token: key,
    body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  }), listed);
  assert.equal(listed.captured.status, 200);
  assert.deepEqual(
    listed.captured.body.result.tools.map((tool) => tool.name),
    ["ask_followups", "draft_linkedin_post"],
  );
  assert.equal(stytchCalls.length, 0);
  assert.equal(findUniques.length, 1);
  assert.equal(findUniques[0].keyHash, hashKey(key));

  const called = fakeRes();
  await mcp(mcpReq({
    token: key,
    body: {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "draft_linkedin_post", arguments: { notes: "   " } },
    },
  }), called);
  assert.equal(called.captured.status, 200);
  assert.equal(called.captured.body.result.isError, true);
  assert.match(called.captured.body.result.content[0].text, /bullet notes/);
  assert.equal(stytchCalls.length, 0);
});

test("a minted key can run draft_linkedin_post when Anthropic answers", async () => {
  const minted = fakeRes();
  await keys(keysReq({ method: "POST", body: { label: "clay" } }), minted);
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    assert.match(String(url), /api\.anthropic\.com/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: JSON.stringify({ post: "A portal is a trust store." }) }],
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    };
  };
  try {
    const res = fakeRes();
    await mcp(mcpReq({
      token: minted.captured.body.key,
      body: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "draft_linkedin_post",
          arguments: { notes: "Portals stock trust." },
        },
      },
    }), res);
    assert.equal(res.captured.status, 200);
    assert.equal(res.captured.body.result.isError, undefined);
    assert.match(res.captured.body.result.structuredContent.post, /trust store/);
    assert.equal(stytchCalls.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("a revoked key is rejected immediately", async () => {
  const minted = fakeRes();
  await keys(keysReq({ method: "POST", body: { label: "clay" } }), minted);
  const key = minted.captured.body.key;
  const id = minted.captured.body.id;

  const revoked = fakeRes();
  await keys(keysReq({ method: "DELETE", body: { id } }), revoked);
  assert.equal(revoked.captured.status, 200);
  assert.equal(revoked.captured.body.revokedAt == null, false);
  assert.equal(revoked.captured.body.key, undefined);
  assert.equal(rows[0].revokedAt instanceof Date, true);

  const again = fakeRes();
  const updatesBefore = updates.length;
  await keys(keysReq({ method: "DELETE", query: { id } }), again);
  assert.equal(again.captured.status, 200);
  assert.equal(again.captured.body.revokedAt, revoked.captured.body.revokedAt);
  assert.equal(updates.length, updatesBefore);

  stytchCalls.length = 0;
  const res = fakeRes();
  await mcp(mcpReq({
    token: key,
    body: { jsonrpc: "2.0", id: 4, method: "tools/list" },
  }), res);
  assert.equal(res.captured.status, 401);
  assert.equal(res.captured.body.error, "Invalid API key.");
  assert.equal(stytchCalls.length, 0);
});

test("garbage bearers are rejected", async () => {
  const malformed = fakeRes();
  const findsBefore = findUniques.length;
  await mcp(mcpReq({
    token: "mcp_not-a-real-key",
    body: { jsonrpc: "2.0", id: 5, method: "tools/list" },
  }), malformed);
  assert.equal(malformed.captured.status, 401);
  assert.equal(malformed.captured.body.error, "Invalid API key.");
  assert.equal(stytchCalls.length, 0);
  assert.equal(findUniques.length, findsBefore);

  const unknown = fakeRes();
  await mcp(mcpReq({
    token: `mcp_${"a".repeat(43)}`,
    body: { jsonrpc: "2.0", id: 6, method: "tools/list" },
  }), unknown);
  assert.equal(unknown.captured.status, 401);
  assert.equal(unknown.captured.body.error, "Invalid API key.");
  assert.equal(stytchCalls.length, 0);
  assert.equal(findUniques.length, findsBefore + 1);

  const session = fakeRes();
  await mcp(mcpReq({
    token: "not-a-session",
    body: { jsonrpc: "2.0", id: 7, method: "tools/list" },
  }), session);
  assert.equal(session.captured.status, 401);
  assert.equal(session.captured.body.error, "Session expired.");
  assert.deepEqual(stytchCalls, ["not-a-session"]);

  const missing = fakeRes();
  await mcp(mcpReq({
    token: "",
    body: { jsonrpc: "2.0", id: 8, method: "tools/list" },
  }), missing);
  assert.equal(missing.captured.status, 401);
  assert.equal(missing.captured.body.error, "Missing token.");
});

test("a Stytch session bearer still lists tools and does not touch the key store", async () => {
  const res = fakeRes();
  await mcp(mcpReq({
    token: "good-token",
    body: { jsonrpc: "2.0", id: 9, method: "tools/list" },
  }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.result.tools[0].name, "ask_followups");
  assert.deepEqual(stytchCalls, ["good-token"]);
  assert.equal(findUniques.length, 0);

  const jwt = fakeRes();
  await mcp(mcpReq({
    token: "good.jwt.token",
    body: { jsonrpc: "2.0", id: 10, method: "ping" },
  }), jwt);
  assert.equal(jwt.captured.status, 200);
  assert.deepEqual(jwt.captured.body.result, {});
  assert.deepEqual(stytchCalls, ["good-token", "good.jwt.token"]);
  assert.equal(findUniques.length, 0);
});

test("an mcp_ key cannot mint or revoke, and is not sent to Stytch", async () => {
  const minted = fakeRes();
  await keys(keysReq({ method: "POST", body: { label: "clay" } }), minted);
  const key = minted.captured.body.key;
  stytchCalls.length = 0;

  const again = fakeRes();
  await keys(keysReq({
    method: "POST",
    token: key,
    body: { label: "again" },
  }), again);
  assert.equal(again.captured.status, 401);
  assert.match(again.captured.body.error, /Stytch session/);
  assert.equal(stytchCalls.length, 0);
  assert.equal(creates.length, 1);

  const revoked = fakeRes();
  await keys(keysReq({
    method: "DELETE",
    token: key,
    body: { id: minted.captured.body.id },
  }), revoked);
  assert.equal(revoked.captured.status, 401);
  assert.equal(rows[0].revokedAt, null);
  assert.equal(stytchCalls.length, 0);
});

test("unauthenticated /api/mcp and /api/mcp-keys are rejected", async () => {
  const mcpRes = fakeRes();
  await mcp({
    method: "POST",
    url: "/api/mcp",
    headers: { "content-type": "application/json" },
    body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  }, mcpRes);
  assert.equal(mcpRes.captured.status, 401);
  assert.equal(mcpRes.captured.body.error, "Missing token.");

  const keysRes = fakeRes();
  await keys(keysReq({ method: "POST", token: "", body: { label: "clay" } }), keysRes);
  assert.equal(keysRes.captured.status, 401);
  assert.equal(creates.length, 0);
});

test("only the owner can mint, and an unconfigured owner id explains how", async () => {
  stytchUserId = "user-other";
  const denied = fakeRes();
  await keys(keysReq({ method: "POST", body: { label: "clay" } }), denied);
  assert.equal(denied.captured.status, 403);
  assert.equal(denied.captured.body.error, "Only the owner can manage MCP API keys.");
  assert.equal(creates.length, 0);

  delete process.env.MCP_KEY_OWNER_USER_ID;
  const unconfigured = fakeRes();
  await keys(keysReq({ method: "GET" }), unconfigured);
  assert.equal(unconfigured.captured.status, 503);
  assert.match(unconfigured.captured.body.error, /MCP_KEY_OWNER_USER_ID/);
  assert.equal(unconfigured.captured.body.userId, "user-other");
  assert.equal(unconfigured.captured.body.error.includes("\u2014"), false);
});

test("a key store outage is 503, not an invalid key", async () => {
  const minted = fakeRes();
  await keys(keysReq({ method: "POST", body: { label: "clay" } }), minted);
  storeShouldThrow = new Error("connection reset");
  const res = fakeRes();
  await mcp(mcpReq({
    token: minted.captured.body.key,
    body: { jsonrpc: "2.0", id: 11, method: "tools/list" },
  }), res);
  assert.equal(res.captured.status, 503);
  assert.equal(res.captured.body.error, "API key store unavailable.");
  assert.equal(stytchCalls.length, 1);
});

test("initialize tells clients about mcp_ keys without an em dash", async () => {
  const res = fakeRes();
  await mcp(mcpReq({
    token: "good-token",
    body: {
      jsonrpc: "2.0",
      id: 12,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "clay", version: "1" } },
    },
  }), res);
  const instructions = res.captured.body.result.instructions;
  assert.match(instructions, /mcp_/);
  assert.equal(instructions.includes("\u2014"), false);
});

test("cli help shows the Clay header and does not use an em dash", () => {
  const result = spawnSync(process.execPath, ["scripts/mcp-keys.js", "--help"], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Authorization: Bearer mcp_/);
  assert.match(result.stdout, /AddMcpServer/);
  assert.equal(result.stdout.includes("\u2014"), false);
  assert.equal(result.stderr.includes("\u2014"), false);
});
