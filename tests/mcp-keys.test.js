/* Durable MCP API keys: mint stores a hash only, /api/mcp accepts a
 * live key, rejects a revoked or garbage key, and still accepts a
 * Stytch session. Stytch and Postgres are stubbed.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-mcp-keys";
process.env.STYTCH_SECRET = "secret-test-not-real";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";

const stytchCalls = [];
const creates = [];
const updates = [];
const findUniques = [];
const sql = [];
let stytchUserId = "user-owner";
let stytchShouldThrow = null;
let storeShouldThrow = null;
const rows = [];
const clients = [];
const codes = [];

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
        userId: data.userId,
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
    findMany: async ({ where } = {}) => {
      if (storeShouldThrow) throw storeShouldThrow;
      return rows
        .filter((row) => !where || row.userId === where.userId)
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
  mcpOAuthClient: {
    create: async ({ data }) => {
      if (storeShouldThrow) throw storeShouldThrow;
      const row = {
        id: `client_${clients.length + 1}`,
        clientId: data.clientId,
        clientName: data.clientName,
        redirectUris: data.redirectUris,
        createdAt: new Date(),
      };
      clients.push(row);
      return row;
    },
    findUnique: async ({ where }) => {
      if (storeShouldThrow) throw storeShouldThrow;
      return clients.find((row) => row.clientId === where.clientId) || null;
    },
  },
  mcpOAuthCode: {
    create: async ({ data }) => {
      if (storeShouldThrow) throw storeShouldThrow;
      const row = {
        id: `code_${codes.length + 1}`,
        usedAt: null,
        createdAt: new Date(),
        ...data,
      };
      codes.push(row);
      return row;
    },
    findUnique: async ({ where }) => {
      if (storeShouldThrow) throw storeShouldThrow;
      return codes.find((row) => row.codeHash === where.codeHash) || null;
    },
    update: async ({ where, data }) => {
      if (storeShouldThrow) throw storeShouldThrow;
      const row = codes.find((item) => item.id === where.id);
      if (!row) {
        const err = new Error("not found");
        err.code = "P2025";
        throw err;
      }
      if (data.usedAt) row.usedAt = data.usedAt;
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
const { OAUTH_TABLE_STATEMENTS, resetOauthCache } = require("../api/_lib/mcp-oauth.js");
const mcp = require("../api/mcp.js");
const oauth = require("../api/mcp-oauth.js");

function fakeRes() {
  const captured = { status: null, body: undefined, headers: {} };
  return {
    captured,
    statusCode: 200,
    setHeader(name, value) { captured.headers[String(name).toLowerCase()] = value; },
    status(code) { captured.status = code; this.statusCode = code; return this; },
    json(body) { captured.body = body; return this; },
    end(body) { if (body !== undefined) captured.body = body; return this; },
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

function oauthReq({ method, op, token = "", body, query = {}, headers = {} } = {}) {
  const params = new URLSearchParams();
  params.set("op", op);
  for (const [key, value] of Object.entries(query)) {
    if (value != null) params.set(key, value);
  }
  return {
    method,
    url: `/api/mcp-oauth?${params.toString()}`,
    headers: {
      authorization: token ? `Bearer ${token}` : "",
      "content-type": typeof body === "string"
        ? "application/x-www-form-urlencoded"
        : "application/json",
      ...headers,
    },
    body,
  };
}

function accessReq({ method = "POST", token = "good-token", body, format } = {}) {
  return oauthReq({
    method,
    op: "access",
    token,
    body,
    query: format ? { format } : {},
  });
}

function reset() {
  stytchCalls.length = 0;
  creates.length = 0;
  updates.length = 0;
  findUniques.length = 0;
  sql.length = 0;
  rows.length = 0;
  clients.length = 0;
  codes.length = 0;
  stytchUserId = "user-owner";
  stytchShouldThrow = null;
  storeShouldThrow = null;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
  resetTableCache();
  resetOauthCache();
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

test("oauth migration SQL matches the statements the server applies", () => {
  const file = fs.readFileSync(
    path.join(__dirname, "..", "prisma", "migrations", "20260924120000_add_mcp_oauth", "migration.sql"),
    "utf8",
  );
  for (const statement of OAUTH_TABLE_STATEMENTS) {
    assert.ok(file.includes(statement), statement.slice(0, 60));
  }
});

test("mint stores the hash only and shows the plaintext once", async () => {
  const direct = await mintMcpKey({ label: " notebook ", userId: "user-owner" });
  assert.match(direct.key, /^mcp_[A-Za-z0-9_-]{43}$/);
  assert.equal(direct.key.includes("."), false);
  assert.deepEqual(Object.keys(creates[0]).sort(), ["keyHash", "label", "userId"]);
  assert.equal(creates[0].userId, "user-owner");
  assert.equal(creates[0].label, "notebook");
  assert.equal(creates[0].keyHash, hashKey(direct.key));
  assert.equal(creates[0].keyHash.includes(direct.key), false);
  assert.equal(JSON.stringify(creates[0]).includes(direct.key), false);
  assert.equal(rows[0].revokedAt, null);
  assert.ok(rows[0].createdAt instanceof Date);
  assert.ok(sql.length >= 1);
  assert.equal(sql.join("\n").includes(direct.key), false);

  reset();
  const res = fakeRes();
  await oauth(accessReq({ body: { action: "mint", label: "notebook" } }), res);
  assert.equal(res.captured.status, 200);
  assert.match(res.captured.body.key, /^mcp_[A-Za-z0-9_-]{43}$/);
  assert.equal(res.captured.body.note, "Copy this credential now. It will not be shown again.");
  assert.equal(res.captured.body.note.includes("\u2014"), false);
  assert.equal(res.captured.body.keyHash, undefined);
  assert.equal(JSON.stringify(res.captured.body).includes(creates[0].keyHash), false);
  assert.equal(creates[0].keyHash, hashKey(res.captured.body.key));

  const listed = fakeRes();
  await oauth(accessReq({ method: "GET", format: "json" }), listed);
  assert.equal(listed.captured.status, 200);
  assert.equal(listed.captured.body.keys.length, 1);
  assert.equal(listed.captured.body.keys[0].id, res.captured.body.id);
  assert.equal(listed.captured.body.keys[0].revokedAt, null);
  assert.equal(JSON.stringify(listed.captured.body).includes(res.captured.body.key), false);
  assert.equal(JSON.stringify(listed.captured.body).includes("keyHash"), false);
});

test("a minted key can list and call tools, and Stytch is not contacted", async () => {
  const minted = fakeRes();
  await oauth(accessReq({ body: { action: "mint", label: "notebook" } }), minted);
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
  await oauth(accessReq({ body: { action: "mint", label: "notebook" } }), minted);
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
  await oauth(accessReq({ body: { action: "mint", label: "notebook" } }), minted);
  const key = minted.captured.body.key;
  const id = minted.captured.body.id;

  const revoked = fakeRes();
  await oauth(accessReq({ body: { action: "revoke", id } }), revoked);
  assert.equal(revoked.captured.status, 200);
  assert.equal(revoked.captured.body.revokedAt == null, false);
  assert.equal(revoked.captured.body.key, undefined);
  assert.equal(rows[0].revokedAt instanceof Date, true);

  const again = fakeRes();
  const updatesBefore = updates.length;
  await oauth(accessReq({ body: { action: "revoke", id } }), again);
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
  await oauth(accessReq({ body: { action: "mint", label: "notebook" } }), minted);
  const key = minted.captured.body.key;
  stytchCalls.length = 0;

  const again = fakeRes();
  await oauth(accessReq({
    token: key,
    body: { action: "mint", label: "again" },
  }), again);
  assert.equal(again.captured.status, 401);
  assert.match(again.captured.body.error, /Sign in to tinker/);
  assert.equal(stytchCalls.length, 0);
  assert.equal(creates.length, 1);

  const revoked = fakeRes();
  await oauth(accessReq({
    token: key,
    body: { action: "revoke", id: minted.captured.body.id },
  }), revoked);
  assert.equal(revoked.captured.status, 401);
  assert.equal(rows[0].revokedAt, null);
  assert.equal(stytchCalls.length, 0);
});

test("unauthenticated /api/mcp and MCP access are rejected", async () => {
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
  await oauth(accessReq({ token: "", body: { action: "mint", label: "notebook" } }), keysRes);
  assert.equal(keysRes.captured.status, 401);
  assert.equal(creates.length, 0);
});

test("a credential is bound to the approving user and hidden from everyone else", async () => {
  const minted = fakeRes();
  await oauth(accessReq({ body: { action: "mint", label: "notebook" } }), minted);
  assert.equal(minted.captured.status, 200);
  assert.equal(creates[0].userId, "user-owner");
  const key = minted.captured.body.key;

  stytchUserId = "user-other";
  const hidden = fakeRes();
  await oauth(accessReq({ method: "GET", format: "json" }), hidden);
  assert.equal(hidden.captured.status, 200);
  assert.deepEqual(hidden.captured.body.keys, []);
  assert.equal(hidden.captured.body.userId, undefined);

  const stolen = fakeRes();
  await oauth(accessReq({ body: { action: "revoke", id: minted.captured.body.id } }), stolen);
  assert.equal(stolen.captured.status, 404);
  assert.equal(rows[0].revokedAt, null);

  const still = fakeRes();
  await mcp(mcpReq({
    token: key,
    body: { jsonrpc: "2.0", id: 30, method: "tools/list" },
  }), still);
  assert.equal(still.captured.status, 200);

  stytchUserId = "user-owner";
  const revoked = fakeRes();
  await oauth(accessReq({ body: { action: "revoke", id: minted.captured.body.id } }), revoked);
  assert.equal(revoked.captured.status, 200);
  assert.ok(revoked.captured.body.revokedAt);
});

test("a key store outage is 503, not an invalid key", async () => {
  const minted = fakeRes();
  await oauth(accessReq({ body: { action: "mint", label: "notebook" } }), minted);
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
  assert.match(instructions, /approve/);
  assert.match(instructions, /mcp_/);
  assert.equal(instructions.includes("Connect Clay"), false);
  assert.equal(instructions.includes("\u2014"), false);
});

test("sign-in returns to the same authorize URL, query string included", () => {
  const auth = fs.readFileSync(path.join(__dirname, "..", "src/renderer/auth.js"), "utf8");
  const start = auth.indexOf("const MCP_RETURN_KEY");
  const end = auth.indexOf("function resumeMcpReturn()");
  assert.ok(start > 0 && end > start);
  const tokenAt = auth.indexOf("auth.token = data.token");
  const resumeAt = auth.indexOf("if (resumeMcpReturn()) return;", tokenAt);
  assert.ok(tokenAt > 0 && resumeAt > tokenAt);
  const map = {};
  const sessionStorage = {
    getItem(key) { return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null; },
    removeItem(key) { delete map[key]; },
  };
  const readBack = new Function(
    "sessionStorage",
    `${auth.slice(start, end)}\nreturn takeMcpReturn;`,
  )(sessionStorage);
  const back = "/mcp/authorize?response_type=code&redirect_uri="
    + encodeURIComponent("http://127.0.0.1:9/callback")
    + "&state=xyz";
  map.tinker_mcp_return = back;
  assert.equal(readBack(), back);
  assert.equal(sessionStorage.getItem("tinker_mcp_return"), null);
  map.tinker_mcp_return = "/elsewhere";
  assert.equal(readBack(), "");
});

test("MCP naming is generic and there is no CLI mint path", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
  const profile = fs.readFileSync(path.join(root, "src/renderer/profile.js"), "utf8");
  const auth = fs.readFileSync(path.join(root, "src/renderer/auth.js"), "utf8");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const pkg = fs.readFileSync(path.join(root, "package.json"), "utf8");
  const mcpSection = readme.split("## MCP\n")[1].split("\n## ")[0];

  assert.equal(fs.existsSync(path.join(root, "src/renderer/mcp-keys.js")), false);
  assert.equal(fs.existsSync(path.join(root, "scripts/mcp-keys.js")), false);
  assert.equal(fs.existsSync(path.join(root, "api/mcp-keys.js")), false);
  assert.equal(pkg.includes("mcp-keys"), false);
  assert.equal(html.includes("Connect Clay"), false);
  assert.equal(html.includes("mcp-keys.js"), false);
  assert.match(html, /id="profile-mcp-access"/);
  assert.match(html, /MCP access/);
  assert.match(profile, /getElementById\("profile-mcp-access"\)/);
  assert.match(profile, /location\.assign\("\/mcp\/access"\)/);
  assert.match(auth, /\/mcp\/authorize/);

  assert.match(mcpSection, /https:\/\/tinker\.beginner\.work\/api\/mcp/);
  assert.match(mcpSection, /approve/i);
  assert.match(mcpSection, /MCP access/);
  assert.match(mcpSection, /shown once/);
  assert.equal(mcpSection.includes("Connect Clay"), false);
  assert.equal(mcpSection.includes("tinker_jwt"), false);
  assert.equal(mcpSection.includes("localStorage"), false);
  assert.equal(mcpSection.includes("DevTools"), false);
  assert.equal(/paste a sign-in token/i.test(mcpSection), true);
  assert.equal(mcpSection.includes("\u2014"), false);
});

function runInlineScript(html, token) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, "page has an inline script");
  const session = {};
  let assigned = "";
  let clicks = 0;
  const sandbox = {
    localStorage: {
      getItem(key) { return key === "tinker_jwt" ? token : ""; },
    },
    sessionStorage: {
      getItem(key) { return Object.prototype.hasOwnProperty.call(session, key) ? session[key] : null; },
      setItem(key, value) { session[key] = String(value); },
    },
    location: {
      pathname: "/mcp/authorize",
      search: "?response_type=code&client_id=abc",
      assign(url) { assigned = String(url); },
    },
    document: {
      getElementById() {
        return {
          textContent: "{}",
          addEventListener() { clicks += 1; },
        };
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(match[1], sandbox);
  return { assigned, session, clicks };
}

test("authorization code with PKCE mints a bearer the client stores", async () => {
  const headers = { host: "tinker.test", "x-forwarded-proto": "https" };
  const resource = "https://tinker.test/api/mcp";
  const redirectUri = "http://127.0.0.1:9/callback";
  const verifier = `v${"a".repeat(50)}`;
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

  const registered = fakeRes();
  await oauth(oauthReq({
    method: "POST",
    op: "register",
    headers,
    body: {
      client_name: "Notebook",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    },
  }), registered);
  assert.equal(registered.captured.status, 201);
  assert.match(registered.captured.body.client_id, /^tkncl_[a-f0-9]{32}$/);
  assert.equal(registered.captured.body.client_secret, undefined);

  const rejected = fakeRes();
  await oauth(oauthReq({
    method: "POST",
    op: "register",
    body: { redirect_uris: ["javascript:alert(1)"] },
  }), rejected);
  assert.equal(rejected.captured.status, 400);
  assert.equal(rejected.captured.body.error, "invalid_redirect_uri");

  const meta = fakeRes();
  await oauth(oauthReq({ method: "GET", op: "resource", headers }), meta);
  assert.equal(meta.captured.body.resource, resource);
  assert.deepEqual(meta.captured.body.authorization_servers, ["https://tinker.test"]);

  const asMeta = fakeRes();
  await oauth(oauthReq({ method: "GET", op: "as", headers }), asMeta);
  assert.equal(asMeta.captured.body.authorization_endpoint, "https://tinker.test/mcp/authorize");
  assert.equal(asMeta.captured.body.token_endpoint, "https://tinker.test/mcp/token");
  assert.equal(asMeta.captured.body.registration_endpoint, "https://tinker.test/mcp/register");
  assert.deepEqual(asMeta.captured.body.code_challenge_methods_supported, ["S256"]);

  const query = {
    response_type: "code",
    client_id: registered.captured.body.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
    state: "xyz",
  };
  const page = fakeRes();
  await oauth(oauthReq({ method: "GET", op: "authorize", headers, query }), page);
  assert.equal(page.captured.status, 200);
  assert.match(page.captured.body, /Notebook wants to use tinker\./);
  assert.equal((page.captured.body.match(/<button\b/gi) || []).length, 1);
  assert.match(page.captured.body, /<button id="mcp-approve" type="button">Approve<\/button>/);
  assert.equal(page.captured.body.includes("Deny"), false);
  assert.equal(/<form\b/i.test(page.captured.body), false);
  assert.equal(/type="checkbox"/i.test(page.captured.body), false);
  assert.equal(page.captured.body.includes("Connect Clay"), false);
  assert.equal(/mcp_[A-Za-z0-9_-]{20,}/.test(page.captured.body), false);
  assert.ok(page.captured.body.indexOf('id="mcp-config"') < page.captured.body.indexOf("mcpConfig()"));
  const signedOut = runInlineScript(page.captured.body, "");
  assert.equal(signedOut.assigned, "/");
  assert.equal(
    signedOut.session.tinker_mcp_return,
    "/mcp/authorize?response_type=code&client_id=abc",
  );
  const signedIn = runInlineScript(page.captured.body, "session-token");
  assert.equal(signedIn.assigned, "");
  assert.equal(signedIn.clicks, 1);

  const accessPage = fakeRes();
  await oauth(oauthReq({ method: "GET", op: "access", headers }), accessPage);
  assert.equal(accessPage.captured.status, 200);
  assert.match(accessPage.captured.body, /Revoke/);
  assert.match(accessPage.captured.body, /shown once/);
  assert.equal(accessPage.captured.body.includes("Connect Clay"), false);
  assert.ok(accessPage.captured.body.indexOf('id="mcp-config"') < accessPage.captured.body.indexOf("mcpConfig()"));
  const accessSignedOut = runInlineScript(accessPage.captured.body, "");
  assert.equal(accessSignedOut.assigned, "/");

  const open = fakeRes();
  await oauth(oauthReq({
    method: "POST",
    op: "authorize",
    token: "good-token",
    headers,
    body: { ...query, redirect_uri: "https://evil.example/steal", decision: "approve" },
  }), open);
  assert.equal(open.captured.status, 400);
  assert.equal(open.captured.body.redirect, undefined);

  const approved = fakeRes();
  await oauth(oauthReq({
    method: "POST",
    op: "authorize",
    token: "good-token",
    headers,
    body: { ...query, decision: "approve" },
  }), approved);
  assert.equal(approved.captured.status, 200);
  const redir = new URL(approved.captured.body.redirect);
  assert.equal(redir.origin + redir.pathname, "http://127.0.0.1:9/callback");
  assert.equal(redir.searchParams.get("state"), "xyz");
  const code = redir.searchParams.get("code");
  assert.ok(code);
  assert.equal(JSON.stringify(codes).includes(code), false);

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: query.client_id,
    code_verifier: verifier,
    resource,
  }).toString();
  const badVerifier = fakeRes();
  await oauth(oauthReq({
    method: "POST",
    op: "token",
    headers,
    body: form.replace(verifier, `${verifier}no`),
  }), badVerifier);
  assert.equal(badVerifier.captured.status, 400);
  assert.equal(badVerifier.captured.body.error, "invalid_grant");
  assert.equal(creates.length, 0);

  const tokenRes = fakeRes();
  await oauth(oauthReq({
    method: "POST",
    op: "token",
    headers,
    body: form,
  }), tokenRes);
  assert.equal(tokenRes.captured.status, 200);
  const access = tokenRes.captured.body.access_token;
  assert.match(access, /^mcp_[A-Za-z0-9_-]{43}$/);
  assert.equal(tokenRes.captured.body.token_type, "Bearer");
  assert.equal(tokenRes.captured.body.refresh_token, undefined);
  assert.equal(creates[0].keyHash, hashKey(access));
  assert.equal(creates[0].label, "Notebook");
  assert.equal(creates[0].userId, "user-owner");

  const replay = fakeRes();
  await oauth(oauthReq({ method: "POST", op: "token", headers, body: form }), replay);
  assert.equal(replay.captured.status, 400);
  assert.equal(replay.captured.body.error, "invalid_grant");
  assert.equal(creates.length, 1);

  stytchCalls.length = 0;
  const listed = fakeRes();
  await mcp(mcpReq({
    token: access,
    headers,
    body: { jsonrpc: "2.0", id: 21, method: "tools/list" },
  }), listed);
  assert.equal(listed.captured.status, 200);
  assert.match(listed.captured.headers["www-authenticate"] || "", /^$/);
  assert.equal(stytchCalls.length, 0);

  const missing = fakeRes();
  await mcp(mcpReq({
    token: "",
    headers,
    body: { jsonrpc: "2.0", id: 22, method: "tools/list" },
  }), missing);
  assert.match(missing.captured.headers["www-authenticate"], /resource_metadata="https:\/\/tinker\.test\/\.well-known\/oauth-protected-resource\/api\/mcp"/);

  const revoked = fakeRes();
  await oauth(accessReq({ body: { action: "revoke", id: rows[0].id } }), revoked);
  assert.equal(revoked.captured.status, 200);
  assert.ok(revoked.captured.body.revokedAt);

  const after = fakeRes();
  await mcp(mcpReq({
    token: access,
    body: { jsonrpc: "2.0", id: 23, method: "tools/list" },
  }), after);
  assert.equal(after.captured.status, 401);
  assert.equal(after.captured.body.error, "Invalid API key.");
});
