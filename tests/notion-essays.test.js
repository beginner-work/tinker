/* Notion public-integration OAuth + Essays database write. */
"use strict";

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const crypto = require("node:crypto");

process.env.STYTCH_PROJECT_ID = "project-test-notion-essays";
process.env.STYTCH_SECRET = "secret-test-notion-essays-key";
process.env.TINKER_SECRETS_KEY = "test-field-secret-notion-essays";
process.env.NOTION_OAUTH_CLIENT_ID = "notion-client-test";
process.env.NOTION_OAUTH_CLIENT_SECRET = "notion-secret-test";
process.env.NOTION_OAUTH_REDIRECT_URI =
  "https://tinker.test/api/notion-oauth?action=callback";

const libDir = path.resolve(__dirname, "..", "api", "_lib");
const apiDir = path.resolve(__dirname, "..", "api");

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
    async delete({ where }) {
      const pair = where.userId_kind;
      const idx = rows.findIndex((r) => r.userId === pair.userId && r.kind === pair.kind);
      if (idx < 0) {
        const err = new Error("Record to delete does not exist.");
        err.code = "P2025";
        throw err;
      }
      rows.splice(idx, 1);
      return { count: 1 };
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

for (const rel of [
  "secrets-crypto.js",
  "notion-oauth.js",
  "notion-token-store.js",
  "notion-api.js",
  "db.js",
  "stytch.js",
  "mcp-keys.js",
  "log.js",
]) {
  delete require.cache[path.join(libDir, rel)];
}
delete require.cache[path.join(apiDir, "notion-oauth.js")];
delete require.cache[path.join(apiDir, "notion-essays.js")];
delete require.cache[path.join(apiDir, "mcp.js")];

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
stubAt(path.join(libDir, "log.js"), {
  withResponseLogging: (fn) => fn,
});

const { encrypt } = require("../api/_lib/secrets-crypto.js");
const store = require("../api/_lib/notion-token-store.js");
const notionApi = require("../api/_lib/notion-api.js");
const oauthHandler = require("../api/notion-oauth.js");
const essaysHandler = require("../api/notion-essays.js");
const mcp = require("../api/mcp.js");

function fakeRes() {
  const captured = { status: null, body: null, headers: {}, html: null };
  return {
    captured,
    setHeader(k, v) { captured.headers[String(k).toLowerCase()] = v; },
    status(c) { captured.status = c; return this; },
    json(p) { captured.body = p; return this; },
    end(html) { captured.html = html; return this; },
  };
}

beforeEach(() => {
  seq = 0;
  rows.length = 0;
});

test("isConfigured reads Notion OAuth env", () => {
  assert.equal(store.isConfigured(), true);
});

test("beginConnect + completeConnect stores encrypted token", async () => {
  const started = await store.beginConnect({ userId: "user-a" });
  assert.match(started.authorizeUrl, /api\.notion\.com\/v1\/oauth\/authorize/);
  assert.match(started.authorizeUrl, /client_id=notion-client-test/);
  const state = new URL(started.authorizeUrl).searchParams.get("state");
  assert.ok(state);

  const result = await store.completeConnect({
    code: "auth-code-1",
    state,
    fetchImpl: async (url, opts) => {
      assert.equal(url, "https://api.notion.com/v1/oauth/token");
      assert.match(opts.headers.Authorization, /^Basic /);
      const body = JSON.parse(opts.body);
      assert.equal(body.grant_type, "authorization_code");
      assert.equal(body.code, "auth-code-1");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: "secret_notion_token",
          token_type: "bearer",
          bot_id: "bot-1",
          workspace_id: "ws-1",
          workspace_name: "Tyler HQ",
        }),
      };
    },
  });
  assert.equal(result.userId, "user-a");
  assert.equal(result.status.connected, true);
  assert.equal(result.status.workspaceName, "Tyler HQ");

  const live = await store.getAccessToken({ userId: "user-a" });
  assert.equal(live.accessToken, "secret_notion_token");
});

test("setParentPage normalizes Notion URL and clears essays db id", async () => {
  rows.push({
    id: "r1",
    userId: "user-a",
    kind: store.KIND,
    data: {
      accessTokenEnc: encrypt("tok"),
      connectedAt: "2026-10-20T00:00:00.000Z",
      essaysDatabaseId: "old-db",
    },
  });
  const pageHex = "a".repeat(32);
  const status = await store.setParentPage({
    userId: "user-a",
    parentPageId: "https://www.notion.so/Workspace-" + pageHex + "?v=1",
  });
  assert.equal(status.parentPageId, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
  assert.equal(status.essaysDatabaseId, null);
});

test("writeEssay creates Essays database then page", async () => {
  const parentId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  rows.push({
    id: "r1",
    userId: "user-a",
    kind: store.KIND,
    data: {
      accessTokenEnc: encrypt("tok"),
      connectedAt: "2026-10-20T00:00:00.000Z",
      parentPageId: parentId,
      essaysDatabaseId: "",
    },
  });

  const calls = [];
  const page = await notionApi.writeEssay({
    userId: "user-a",
    title: "What I noticed",
    body: "First paragraph.\n\nSecond paragraph.",
    date: "2026-10-19",
    learningGoal: "Ship the loop",
    exercise: "from-essays",
    fetchImpl: async (url, opts) => {
      calls.push({ url, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
      if (url.endsWith("/search")) {
        return { ok: true, status: 200, json: async () => ({ results: [] }) };
      }
      if (url.endsWith("/databases") && opts.method === "POST") {
        assert.equal(calls[calls.length - 1].body.parent.page_id, parentId);
        assert.equal(calls[calls.length - 1].body.title[0].text.content, "Essays");
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "cccccccc-cccc-cccc-cccc-cccccccccccc" }),
        };
      }
      if (url.endsWith("/pages") && opts.method === "POST") {
        const body = calls[calls.length - 1].body;
        assert.equal(body.parent.database_id, "cccccccc-cccc-cccc-cccc-cccccccccccc");
        assert.equal(body.properties.Date.date.start, "2026-10-19");
        assert.ok(body.children.length >= 2);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "page-1",
            url: "https://www.notion.so/page-1",
          }),
        };
      }
      throw new Error("unexpected " + url);
    },
  });
  assert.equal(page.id, "page-1");
  assert.equal(page.databaseId, "cccccccc-cccc-cccc-cccc-cccccccccccc");
  const settings = await store.getSettings({ userId: "user-a" });
  assert.equal(settings.essaysDatabaseId, "cccccccc-cccc-cccc-cccc-cccccccccccc");
});

test("POST /api/notion-essays writes when connected", async () => {
  rows.push({
    id: "r1",
    userId: "user-a",
    kind: store.KIND,
    data: {
      accessTokenEnc: encrypt("tok"),
      connectedAt: "2026-10-20T00:00:00.000Z",
      parentPageId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      essaysDatabaseId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    },
  });
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    assert.match(String(url), /\/pages$/);
    assert.equal(opts.method, "POST");
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "np1", url: "https://notion.so/np1" }),
    };
  };
  try {
    const res = fakeRes();
    await essaysHandler({
      method: "POST",
      url: "/api/notion-essays",
      headers: { authorization: "Bearer user-a" },
      body: { title: "Hi", body: "Body text here." },
    }, res);
    assert.equal(res.captured.status, 200);
    assert.equal(res.captured.body.ok, true);
    assert.equal(res.captured.body.page.id, "np1");
  } finally {
    global.fetch = originalFetch;
  }
});

test("oauth status endpoint returns configured + connected", async () => {
  rows.push({
    id: "r1",
    userId: "user-a",
    kind: store.KIND,
    data: {
      accessTokenEnc: encrypt("tok"),
      connectedAt: "2026-10-20T00:00:00.000Z",
      workspaceName: "HQ",
    },
  });
  const res = fakeRes();
  await oauthHandler({
    method: "GET",
    url: "/api/notion-oauth",
    headers: { authorization: "Bearer user-a" },
  }, res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.connected, true);
  assert.equal(res.captured.body.configured, true);
  assert.equal(res.captured.body.workspaceName, "HQ");
});

test("tools/list includes notion_write_essay", async () => {
  const res = fakeRes();
  await mcp({
    method: "POST",
    url: "/api/mcp",
    headers: { authorization: "Bearer " + "mcp_" + "a".repeat(43) },
    body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  }, res);
  const names = res.captured.body.result.tools.map((t) => t.name);
  assert.ok(names.includes("notion_write_essay"));
});

test("Writing app has Connect Notion corner control", () => {
  const fs = require("fs");
  const html = fs.readFileSync(
    path.join(__dirname, "..", "src/renderer/connections/index.html"),
    "utf8",
  );
  const connectionsJs = fs.readFileSync(
    path.join(__dirname, "..", "src/renderer/connections/connections.js"),
    "utf8",
  );
  const repoHtml = fs.readFileSync(
    path.join(__dirname, "..", "src/renderer/repo/index.html"),
    "utf8",
  );
  const repoJs = fs.readFileSync(
    path.join(__dirname, "..", "src/renderer/repo/repo.js"),
    "utf8",
  );
  const repoCss = fs.readFileSync(
    path.join(__dirname, "..", "src/renderer/repo/repo.css"),
    "utf8",
  );
  const oauth = fs.readFileSync(
    path.join(__dirname, "..", "api/notion-oauth.js"),
    "utf8",
  );
  assert.match(html, /data-notion-essays/);
  assert.match(html, /Notion essays/);
  assert.doesNotMatch(html, /\u2014/);
  assert.doesNotMatch(html, /\bfree\b/i);
  assert.doesNotMatch(html, /\bquietly\b/i);
  assert.doesNotMatch(html, /\breal\b/i);
  // Connect starts from the writing-app corner, not Connections.
  assert.doesNotMatch(connectionsJs, /data-action="notion-connect"/);
  assert.doesNotMatch(connectionsJs, /\/api\/notion-oauth\?action=connect/);
  assert.match(repoHtml, /id="repo-notion-connect"/);
  assert.match(repoHtml, /Connect Notion/);
  assert.match(repoHtml, /repo-notion-connect__dot/);
  assert.doesNotMatch(repoHtml, /\u2014/);
  assert.doesNotMatch(repoHtml, /\bfree\b/i);
  assert.doesNotMatch(repoHtml, /\bquietly\b/i);
  assert.doesNotMatch(repoHtml, /\breal\b/i);
  assert.match(repoCss, /\.repo-notion-connect\s*\{/);
  assert.match(repoCss, /repo-notion-connect__dot/);
  assert.match(repoJs, /startNotionOAuth/);
  assert.match(repoJs, /\/api\/notion-oauth\?action=connect/);
  assert.match(repoJs, /scheduleNotionEssayWrite/);
  assert.match(repoJs, /\/api\/notion-essays/);
  assert.match(oauth, /\/repo\?notion=connected/);
});

test("hashState is stable", () => {
  const oauth = require("../api/_lib/notion-oauth.js");
  const a = oauth.hashState("abc");
  const b = oauth.hashState("abc");
  assert.equal(a, b);
  assert.equal(a.length, 64);
  assert.notEqual(a, crypto.createHash("sha256").update("xyz").digest("hex"));
});
