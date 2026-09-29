/* MCP update_owner_profile merges title / linkedInUrl on the owner profile. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-owner-profile";
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
for (const rel of ["db.js", "stytch.js", "mcp-keys.js"]) {
  delete require.cache[path.join(libDir, rel)];
}
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

test("tools/list includes update_owner_profile", async () => {
  const res = fakeRes();
  await mcp({
    method: "POST", url: "/api/mcp",
    headers: { authorization: "Bearer " + "mcp_" + "a".repeat(43) },
    body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
  }, res);
  const names = res.captured.body.result.tools.map((t) => t.name);
  assert.ok(names.includes("update_owner_profile"));
});

test("update_owner_profile sets title and linkedInUrl for the caller only", async () => {
  tables.tinkerUserData.rows.push({
    id: "seed",
    userId: "user-a",
    kind: "profile",
    data: { name: "Tyler", avatarUrl: "data:img", email: "t@example.com" },
    updatedAt: new Date(),
  });
  const out = await mcpCall("mcp_" + "a".repeat(43), "update_owner_profile", {
    title: "Founder at Lindow Labs",
    linkedInUrl: "https://www.linkedin.com/in/tyler-owner",
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.result.isError, undefined);
  const shaped = out.body.result.structuredContent.profile;
  assert.equal(shaped.title, "Founder at Lindow Labs");
  assert.equal(shaped.linkedInUrl, "https://www.linkedin.com/in/tyler-owner");
  assert.equal(shaped.name, "Tyler");
  const row = tables.tinkerUserData.rows.find((r) => r.userId === "user-a" && r.kind === "profile");
  assert.equal(row.data.name, "Tyler");
  assert.equal(row.data.avatarUrl, "data:img");
  assert.equal(row.data.title, "Founder at Lindow Labs");
});

test("update_owner_profile omits leave fields unchanged and empty string clears", async () => {
  tables.tinkerUserData.rows.push({
    id: "seed",
    userId: "user-a",
    kind: "profile",
    data: {
      name: "Tyler",
      title: "Founder",
      linkedInUrl: "https://www.linkedin.com/in/old",
    },
    updatedAt: new Date(),
  });
  const titleOnly = await mcpCall("mcp_" + "a".repeat(43), "update_owner_profile", {
    title: "Builder",
  });
  assert.equal(titleOnly.body.result.structuredContent.profile.title, "Builder");
  assert.equal(titleOnly.body.result.structuredContent.profile.linkedInUrl, "https://www.linkedin.com/in/old");

  const clearLi = await mcpCall("mcp_" + "a".repeat(43), "update_owner_profile", {
    linkedInUrl: "",
  });
  assert.equal(clearLi.body.result.structuredContent.profile.linkedInUrl, "");
  assert.equal(clearLi.body.result.structuredContent.profile.title, "Builder");
});

test("update_owner_profile rejects bad urls and does not write another user", async () => {
  const bad = await mcpCall("mcp_" + "a".repeat(43), "update_owner_profile", {
    linkedInUrl: "linkedin.com/in/nope",
  });
  assert.equal(bad.body.result.isError, true);
  assert.match(bad.body.result.content[0].text, /http/i);

  tables.tinkerUserData.rows.push({
    id: "other",
    userId: "user-b",
    kind: "profile",
    data: { name: "Other", title: "Keep me" },
    updatedAt: new Date(),
  });
  await mcpCall("mcp_" + "a".repeat(43), "update_owner_profile", { title: "Only A" });
  const other = tables.tinkerUserData.rows.find((r) => r.userId === "user-b");
  assert.equal(other.data.title, "Keep me");
});
