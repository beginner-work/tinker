/* Outbound MCP Connections: registry, OAuth store, API, converse attach. */
"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const Module = require("node:module");
const crypto = require("node:crypto");

process.env.STYTCH_PROJECT_ID = "project-test-mcp-connections";
process.env.STYTCH_SECRET = "secret-test-mcp-connections-key";
process.env.TINKER_SECRETS_KEY = "test-field-secret-mcp-connections";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";

const root = path.join(__dirname, "..");
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
  "mcp-connectors-registry.js",
  "mcp-connection-oauth.js",
  "mcp-connection-store.js",
  "anthropic.js",
  "db.js",
  "stytch.js",
  "mcp-keys.js",
  "mcp-origin.js",
  "log.js",
  "linkedin-draft.js",
]) {
  delete require.cache[path.join(libDir, rel)];
}
delete require.cache[path.join(apiDir, "connections.js")];
delete require.cache[path.join(apiDir, "claude", "converse.js")];

stubAt(path.join(libDir, "stytch.js"), {
  authenticateSession: async (token) => {
    if (token !== "user-a" && token !== "user-b") {
      throw Object.assign(new Error("nope"), { status: 401 });
    }
    return { session: { user_id: token } };
  },
});
stubAt(path.join(libDir, "db.js"), database);
stubAt(path.join(libDir, "mcp-keys.js"), {
  isMcpApiKey: (t) => typeof t === "string" && t.startsWith("mcp_"),
  userIdFromSession: (s) => (s && s.session && s.session.user_id) || "",
});
stubAt(path.join(libDir, "mcp-origin.js"), {
  publicOrigin: () => "https://tinker.test",
});
stubAt(path.join(libDir, "log.js"), {
  withResponseLogging: (fn) => fn,
});
stubAt(path.join(libDir, "linkedin-draft.js"), {
  draftLinkedInPost: async () => ({ text: "li" }),
});

let anthropicCalls = [];
stubAt(path.join(libDir, "anthropic.js"), {
  MCP_CLIENT_BETA: "mcp-client-2025-11-20",
  callAnthropic: async (args) => {
    anthropicCalls.push(args);
    return { text: "ok", usage: {}, stop_reason: "end_turn" };
  },
});

const registry = require("../api/_lib/mcp-connectors-registry.js");
const oauth = require("../api/_lib/mcp-connection-oauth.js");
const store = require("../api/_lib/mcp-connection-store.js");
const { encrypt, decrypt } = require("../api/_lib/secrets-crypto.js");
const connectionsApi = require("../api/connections.js");
const converse = require("../api/claude/converse.js");

function fakeRes() {
  const captured = { status: null, body: null, headers: {}, html: null };
  return {
    captured,
    setHeader(k, v) { captured.headers[k] = v; },
    status(code) {
      captured.status = code;
      return {
        json(body) { captured.body = body; return captured; },
        end(html) { captured.html = html; return captured; },
      };
    },
    get statusCode() { return captured.status; },
    set statusCode(v) { captured.status = v; },
    end(html) { captured.html = html; },
  };
}

async function apiCall(method, url, { token, body } = {}) {
  const res = fakeRes();
  await connectionsApi({
    method,
    url,
    headers: token ? { authorization: "Bearer " + token } : {},
    body: body ? JSON.stringify(body) : undefined,
  }, res);
  return res.captured;
}

after(() => {
  rows.length = 0;
});

test("registry lists Notion first with read-only defaults", () => {
  const list = registry.listConnectors();
  assert.ok(list.length >= 1);
  assert.equal(list[0].id, "notion");
  assert.equal(list[0].url, "https://mcp.notion.com/mcp");
  assert.equal(list[0].authType, "oauth");
  assert.deepEqual(list[0].defaultReadTools, ["notion-search", "notion-fetch"]);
  assert.equal(registry.getConnector("nope"), null);
});

test("PKCE challenge is S256 of verifier", () => {
  const pkce = oauth.generatePkce();
  assert.equal(pkce.method, "S256");
  assert.ok(pkce.verifier.length >= 32);
  const expected = crypto
    .createHash("sha256")
    .update(pkce.verifier)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  assert.equal(pkce.challenge, expected);
});

test("list is disconnected by default; connect flow stores encrypted tokens", async () => {
  rows.length = 0;
  const listed = await store.listConnections({ userId: "user-a" });
  assert.equal(listed.connectors[0].connected, false);
  assert.equal(listed.connectors[0].writeAccess, false);

  const fetches = [];
  const fetchImpl = async (url, opts) => {
    fetches.push({ url: String(url), opts });
    if (String(url).includes("oauth-protected-resource")) {
      return {
        ok: true,
        async json() {
          return {
            resource: "https://mcp.notion.com/mcp",
            authorization_servers: ["https://mcp.notion.com"],
          };
        },
      };
    }
    if (String(url).includes("oauth-authorization-server")) {
      return {
        ok: true,
        async json() {
          return {
            authorization_endpoint: "https://mcp.notion.com/authorize",
            token_endpoint: "https://mcp.notion.com/token",
            registration_endpoint: "https://mcp.notion.com/register",
            scopes_supported: ["default"],
            code_challenge_methods_supported: ["S256"],
          };
        },
      };
    }
    if (String(url).includes("/register")) {
      return {
        ok: true,
        async json() {
          return { client_id: "notion-client-test" };
        },
      };
    }
    if (String(url).includes("/token")) {
      const body = String(opts.body || "");
      assert.match(body, /grant_type=authorization_code/);
      assert.match(body, /code_verifier=/);
      return {
        ok: true,
        async json() {
          return {
            access_token: "access-secret-abc",
            refresh_token: "refresh-secret-xyz",
            expires_in: 3600,
            token_type: "Bearer",
          };
        },
      };
    }
    throw new Error("unexpected fetch " + url);
  };

  const started = await store.beginConnect({
    userId: "user-a",
    connectorId: "notion",
    redirectUri: "https://tinker.test/api/connections?action=callback",
    fetchImpl,
  });
  assert.match(started.authorizeUrl, /^https:\/\/mcp\.notion\.com\/authorize/);
  assert.match(started.authorizeUrl, /code_challenge=/);
  assert.match(started.authorizeUrl, /client_id=notion-client-test/);

  const authUrl = new URL(started.authorizeUrl);
  const state = authUrl.searchParams.get("state");
  assert.ok(state);

  const done = await store.completeConnect({
    code: "auth-code-1",
    state,
    fetchImpl,
  });
  assert.equal(done.connectorId, "notion");
  assert.equal(done.userId, "user-a");

  const after = await store.listConnections({ userId: "user-a" });
  assert.equal(after.connectors[0].connected, true);
  assert.equal(after.connectors[0].writeAccess, false);

  const live = await store.getValidAccessToken({ userId: "user-a", connectorId: "notion" });
  assert.equal(live.accessToken, "access-secret-abc");
  assert.equal(live.writeAccess, false);

  // Tokens are encrypted at rest (not plaintext in the row).
  const row = rows.find((r) => r.userId === "user-a" && r.kind === "mcp_out_conn:notion");
  assert.ok(row);
  assert.notEqual(row.data.accessTokenEnc, "access-secret-abc");
  assert.equal(decrypt(row.data.accessTokenEnc), "access-secret-abc");
});

test("write access requires confirmed flag; expires attachment shape", async () => {
  rows.length = 0;
  // Seed a connected row directly.
  await database.tinkerUserData.create({
    data: {
      userId: "user-a",
      kind: "mcp_out_conn:notion",
      data: {
        accessTokenEnc: encrypt("tok"),
        refreshTokenEnc: "",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        clientId: "c1",
        resource: "https://mcp.notion.com/mcp",
        connectedAt: new Date().toISOString(),
        writeAccess: false,
        writeAccessUntil: null,
      },
    },
  });

  await assert.rejects(
    () => store.setWriteAccess({ userId: "user-a", connectorId: "notion", enabled: true, confirmed: false }),
    /Confirm write access/,
  );

  const enabled = await store.setWriteAccess({
    userId: "user-a",
    connectorId: "notion",
    enabled: true,
    confirmed: true,
  });
  assert.equal(enabled.writeAccess, true);

  const attached = await store.buildAnthropicMcpAttachment({ userId: "user-a" });
  assert.equal(attached.mcp_servers.length, 1);
  assert.equal(attached.mcp_servers[0].name, "tinker-notion");
  assert.equal(attached.mcp_servers[0].authorization_token, "tok");
  assert.equal(attached.tools[0].type, "mcp_toolset");
  assert.equal(attached.tools[0].default_config.enabled, true);

  await store.setWriteAccess({
    userId: "user-a",
    connectorId: "notion",
    enabled: false,
    confirmed: false,
  });
  const readOnly = await store.buildAnthropicMcpAttachment({ userId: "user-a" });
  assert.equal(readOnly.tools[0].default_config.enabled, false);
  assert.equal(readOnly.tools[0].configs["notion-search"].enabled, true);
  assert.equal(readOnly.tools[0].configs["notion-fetch"].enabled, true);
});

test("disconnect clears the connection", async () => {
  rows.length = 0;
  await database.tinkerUserData.create({
    data: {
      userId: "user-a",
      kind: "mcp_out_conn:notion",
      data: {
        accessTokenEnc: encrypt("tok"),
        connectedAt: new Date().toISOString(),
      },
    },
  });
  await store.disconnect({ userId: "user-a", connectorId: "notion" });
  const listed = await store.listConnections({ userId: "user-a" });
  assert.equal(listed.connectors[0].connected, false);
});

test("HTTP API lists, rejects mcp_ bearer, and disconnects", async () => {
  rows.length = 0;
  const listed = await apiCall("GET", "/api/connections", { token: "user-a" });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.connectors[0].id, "notion");
  assert.equal(listed.body.connectors[0].connected, false);

  const mcpRejected = await apiCall("GET", "/api/connections", {
    token: "mcp_" + "a".repeat(43),
  });
  assert.equal(mcpRejected.status, 401);

  await database.tinkerUserData.create({
    data: {
      userId: "user-a",
      kind: "mcp_out_conn:notion",
      data: { accessTokenEnc: encrypt("tok"), connectedAt: new Date().toISOString() },
    },
  });
  const gone = await apiCall("DELETE", "/api/connections?action=disconnect&id=notion", {
    token: "user-a",
  });
  assert.equal(gone.status, 200);
  assert.equal(gone.body.ok, true);
});

test("converse attaches read-only Notion MCP tools when connected", async () => {
  rows.length = 0;
  anthropicCalls = [];
  await database.tinkerUserData.create({
    data: {
      userId: "user-a",
      kind: "mcp_out_conn:notion",
      data: {
        accessTokenEnc: encrypt("notion-access"),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        connectedAt: new Date().toISOString(),
        writeAccess: false,
      },
    },
  });

  const res = fakeRes();
  await converse({
    method: "POST",
    url: "/api/claude/converse",
    headers: { authorization: "Bearer user-a" },
    body: {
      messages: [{ role: "user", content: "Find my notes" }],
      model: "claude-haiku-4-5-20251001",
      maxTokens: 256,
    },
  }, res);

  assert.equal(res.captured.status, 200);
  assert.equal(anthropicCalls.length, 1);
  const call = anthropicCalls[0];
  assert.ok(Array.isArray(call.mcp_servers));
  assert.equal(call.mcp_servers[0].url, "https://mcp.notion.com/mcp");
  assert.equal(call.mcp_servers[0].authorization_token, "notion-access");
  const toolset = call.tools.find((t) => t && t.type === "mcp_toolset");
  assert.ok(toolset);
  assert.equal(toolset.default_config.enabled, false);
  assert.equal(toolset.configs["notion-search"].enabled, true);
});

test("UI + routes expose Connections without breaking MCP access", () => {
  const settings = fs.readFileSync(path.join(root, "src/renderer/settings/index.html"), "utf8");
  const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
  const profile = fs.readFileSync(path.join(root, "src/renderer/profile.js"), "utf8");
  const auth = fs.readFileSync(path.join(root, "src/renderer/auth.js"), "utf8");
  const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
  const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
  const connHtml = fs.readFileSync(path.join(root, "src/renderer/connections/index.html"), "utf8");
  const connJs = fs.readFileSync(path.join(root, "src/renderer/connections/connections.js"), "utf8");
  const envEx = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  const notes = fs.readFileSync(path.join(root, ".release-notes"), "utf8");
  const mcpApi = fs.readFileSync(path.join(root, "api/mcp.js"), "utf8");
  const mcpOauth = fs.readFileSync(path.join(root, "api/mcp-oauth.js"), "utf8");

  assert.match(settings, /href="\/connections"/);
  assert.match(settings, /href="\/mcp\/access"/);
  assert.match(html, /id="profile-connections"/);
  assert.match(html, /id="profile-mcp-access"/);
  assert.match(profile, /\/connections/);
  assert.match(profile, /\/mcp\/access/);
  assert.match(auth, /\/connections/);
  assert.match(vercel, /"\/connections"/);
  assert.match(sw, /\/connections/);
  assert.match(connHtml, /Connections/);
  assert.match(connHtml, /data-connections-list/);
  assert.match(connJs, /action=connect/);
  assert.match(connJs, /Allow writes/);
  assert.match(connJs, /confirmed/);
  assert.match(envEx, /TINKER_SECRETS_KEY/);
  assert.equal(notes.split(/\r?\n/, 1)[0].trim(), "No download needed, updates on next launch");
  assert.match(notes, /Notion/);
  assert.equal(notes.includes("\u2014"), false);
  assert.equal(/\bfree\b/i.test(notes), false);
  assert.equal(/\breal\b/i.test(notes), false);
  assert.equal(/\bquietly\b/i.test(notes), false);

  // Inbound MCP server files still exist and are distinct.
  assert.match(mcpApi, /tools\/list/);
  assert.match(mcpOauth, /MCP access/);
  assert.equal(fs.existsSync(path.join(root, "api/connections.js")), true);
  assert.equal(fs.existsSync(path.join(root, "api/_lib/mcp-connection-store.js")), true);
});

test("secrets crypto round-trips with TINKER_SECRETS_KEY", () => {
  const blob = encrypt("notion-token-value");
  assert.notEqual(blob, "notion-token-value");
  assert.equal(decrypt(blob), "notion-token-value");
});
