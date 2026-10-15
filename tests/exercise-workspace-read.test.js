"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const core = require("../src/renderer/lib/exercise-workspace-core.js");

function loadModule(relative, mocks) {
  const filename = path.join(__dirname, "..", relative);
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, exports: module.exports, __dirname: path.dirname(filename),
    require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : nativeRequire(name),
    Buffer, URL, console,
  }, { filename });
  return module.exports;
}

function storeFixture(row) {
  const reads = [], writes = [];
  const store = loadModule("api/_lib/exercise-workspace-store.js", {
    "./db.js": { tinkerUserData: {
      async findUnique(args) { reads.push(args); return row; },
      async upsert(args) { writes.push(args); return { updatedAt: "saved" }; },
    } },
  });
  return { store, reads, writes };
}

test("read-only first visit returns seeded exercises without creating owner data", async () => {
  const f = storeFixture(null);
  const result = await f.store.listWorkspace({ userId: "owner-a", readOnly: true });
  assert.ok(result.workspace.exerciseOrder.length > 0);
  assert.equal(result.seeded, true);
  assert.equal(result.updatedAt, null);
  assert.equal(f.writes.length, 0);
  assert.equal(f.reads[0].where.userId_kind.userId, "owner-a");
  assert.equal(f.reads[0].where.userId_kind.kind, "exercise_workspace");
});

test("read-only seed merge and pruning never persist or overwrite saved contents", async () => {
  const f = storeFixture(null);
  const saved = core.normalizeWorkspace(f.store.seedWorkspace());
  const id = saved.exerciseOrder[0];
  const node = saved.exercises[id].nodes.find(n => n.type === "file");
  node.content = "Owner's saved exercise text";
  saved.exercises.retired = { id: "retired", name: "Retired", nodes: [] };
  saved.exerciseOrder.push("retired");
  const before = JSON.stringify(saved);
  const g = storeFixture({ data: saved, updatedAt: "original" });
  const result = await g.store.listWorkspace({ userId: "owner-a", readOnly: true });
  assert.equal(result.workspace.exercises[id].nodes.find(n => n.id === node.id).content, node.content);
  assert.equal(result.workspace.exercises.retired, undefined);
  assert.equal(result.updatedAt, "original");
  assert.equal(JSON.stringify(saved), before);
  assert.equal(g.writes.length, 0);

  const empty = storeFixture({ data: core.emptyWorkspace(), updatedAt: "empty" });
  const merged = await empty.store.listWorkspace({ userId: "owner-a", readOnly: true });
  assert.ok(merged.workspace.exerciseOrder.length > 0);
  assert.equal(empty.writes.length, 0);
});

test("ordinary desktop listing still creates missing owner workspace", async () => {
  const f = storeFixture(null);
  await f.store.listWorkspace({ userId: "owner-a" });
  assert.equal(f.writes.length, 1);
});

function apiFixture() {
  const calls = [];
  const handler = loadModule("api/exercise-workspace.js", {
    "./_lib/stytch.js": { authenticateSession: async token => {
      if (token === "expired") throw Object.assign(new Error("expired"), { status: 401 });
      return { userId: "authenticated-owner" };
    } },
    "./_lib/mcp-keys.js": { userIdFromSession: session => session.userId },
    "./_lib/log.js": { withResponseLogging: fn => fn },
    "./_lib/exercise-workspace-store.js": { listWorkspace: async args => {
      calls.push(args); return { workspace: { exerciseOrder: [] } };
    } },
  });
  async function request(token) {
    const headers = {};
    const response = { headers, setHeader(k, v) { headers[k] = v; },
      status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await handler({ method: "GET", headers: token ? { authorization: "Bearer " + token } : {},
      query: { action: "read", userId: "other-owner" }, body: { userId: "other-owner" } }, response);
    return response;
  }
  return { calls, request };
}

test("read endpoint scopes data to authenticated owner and disables caching", async () => {
  const f = apiFixture();
  const response = await f.request("valid-session");
  assert.equal(response.code, 200);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].userId, "authenticated-owner");
  assert.equal(f.calls[0].readOnly, true);
});

test("read endpoint rejects missing, expired, and connector credentials before reading data", async () => {
  for (const token of [null, "expired", "mcp_connector"]) {
    const f = apiFixture();
    assert.equal((await f.request(token)).code, 401);
    assert.equal(f.calls.length, 0);
  }
});
