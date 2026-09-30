/* Reflection webhook: Authorization sent on ping; secrets never echoed. */
"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const http = require("node:http");

process.env.STYTCH_PROJECT_ID = "project-test-reflection-webhook";
process.env.STYTCH_SECRET = "secret-test-reflection-webhook-key";
process.env.TINKER_SECRETS_KEY = "test-field-secret-reflection-webhook";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";

let seq = 0;
const rows = [];
const database = {
  $executeRawUnsafe: async () => 0,
  $transaction: async (fn) => fn(database),
  tinkerUserData: {
    rows,
    async create({ data }) {
      const now = new Date();
      const row = Object.assign({ id: "row_" + (++seq), createdAt: now, updatedAt: now }, data);
      rows.push(row);
      return row;
    },
    async findUnique({ where }) {
      const pair = where.userId_kind;
      return pair ? rows.find((r) => r.userId === pair.userId && r.kind === pair.kind) || null : null;
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
  mod.filename = absPath; mod.loaded = true; mod.exports = exports;
  require.cache[absPath] = mod;
}
const libDir = path.resolve(__dirname, "..", "api", "_lib");
const apiDir = path.resolve(__dirname, "..", "api");
for (const rel of [
  "secrets-crypto.js", "reflection-webhook-store.js", "reflection-webhook-ping.js",
  "db.js", "stytch.js", "mcp-keys.js",
]) delete require.cache[path.join(libDir, rel)];
delete require.cache[path.join(apiDir, "mcp.js")];
delete require.cache[path.join(apiDir, "reflection-webhook.js")];

stubAt(path.join(libDir, "stytch.js"), {
  authenticateSession: async (token) => {
    if (token !== "user-a") throw Object.assign(new Error("nope"), { status: 401 });
    return { session: { user_id: token } };
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

const cryptoLib = require("../api/_lib/secrets-crypto.js");
const store = require("../api/_lib/reflection-webhook-store.js");
const ping = require("../api/_lib/reflection-webhook-ping.js");
const mcp = require("../api/mcp.js");
const ownerApi = require("../api/reflection-webhook.js");
const BOT = "mcp_" + "a".repeat(43);
const AUTH = "Bearer super-secret-token-XYZ9";
const URL_HTTPS = "https://hooks.example.test/reflection";

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
    headers: { authorization: "Bearer " + BOT },
    body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args || {} } },
  }, res);
  return res.captured;
}
function startCapture() {
  const hits = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      hits.push({
        authorization: req.headers.authorization || "",
        contentType: req.headers["content-type"] || "",
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.statusCode = 204; res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ hits, url: "http://127.0.0.1:" + port + "/hook", close: () => new Promise((r) => server.close(r)) });
    });
  });
}
async function seedHttpWebhook(url) {
  const { encrypt, maskSecret } = cryptoLib;
  const data = {
    urlEnc: encrypt(url), authEnc: encrypt(AUTH),
    urlHint: maskSecret(url), authorizationHint: maskSecret(AUTH),
    updatedAt: new Date().toISOString(), lastPingAt: null, pending: null,
  };
  const existing = rows.find((r) => r.userId === "user-a" && r.kind === "reflection_webhook");
  if (existing) { existing.data = data; return; }
  rows.push({
    id: "wh", userId: "user-a", kind: "reflection_webhook", data,
    createdAt: new Date(), updatedAt: new Date(),
  });
}

test.beforeEach(() => { seq = 0; rows.length = 0; ping.resetTimers(); });
after(() => { ping.resetTimers(); });

test("set/clear never echo secrets; ping sends Authorization; debounce is one shot", async () => {
  const set = await mcpCall("set_reflection_webhook", {
    url: URL_HTTPS, authorization: AUTH, userId: "someone-else",
  });
  const webhook = set.body.result.structuredContent.webhook;
  assert.equal(webhook.configured, true);
  assert.equal(webhook.authorizationHint, cryptoLib.maskSecret(AUTH));
  assert.equal(JSON.stringify(set.body).includes(AUTH), false);
  assert.equal(JSON.stringify(set.body).includes(URL_HTTPS), false);

  const res = fakeRes();
  await ownerApi({
    method: "GET", url: "/api/reflection-webhook",
    headers: { authorization: "Bearer user-a" },
  }, res);
  assert.equal(JSON.stringify(res.captured.body).includes(AUTH), false);

  const cleared = await mcpCall("clear_reflection_webhook", {});
  assert.equal(cleared.body.result.structuredContent.webhook.configured, false);

  const capture = await startCapture();
  try {
    await seedHttpWebhook(capture.url);
    await ping.notifyReflectionSaved("user-a", {
      reflectionId: "e_abc", title: "one", updatedAt: "2026-09-30T19:00:00.000Z",
    });
    await ping.notifyReflectionSaved("user-a", {
      reflectionId: "e_abc", title: "Quiet morning", updatedAt: "2026-09-30T19:01:00.000Z",
    });
    assert.equal(capture.hits.length, 0);
    await ping.flushNow("user-a");
    assert.equal(capture.hits.length, 1);
    assert.equal(capture.hits[0].authorization, AUTH);
    assert.match(capture.hits[0].contentType, /application\/json/);
    assert.deepEqual(JSON.parse(capture.hits[0].body), {
      event: "reflection_saved",
      reflectionId: "e_abc",
      title: "Quiet morning",
      updatedAt: "2026-09-30T19:01:00.000Z",
    });
    assert.equal(JSON.stringify(await store.getPublic({ userId: "user-a" })).includes(AUTH), false);
  } finally { await capture.close(); }
});
