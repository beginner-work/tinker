"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const clone = value => JSON.parse(JSON.stringify(value));
const rows = new Map();
let beforeUpdate = null;
let writes = 0;
const db = { tinkerUserData: {
  async findUnique({ where }) { const row = rows.get(where.userId_kind.userId); return row ? clone(row) : null; },
  async create({ data }) {
    if (rows.has(data.userId)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
    const row = { ...clone(data), updatedAt: new Date().toISOString() }; rows.set(data.userId, row); writes++; return clone(row);
  },
  async updateMany({ where, data }) {
    if (beforeUpdate) { const hook = beforeUpdate; beforeUpdate = null; hook(); }
    const row = rows.get(where.userId);
    if (!row || row.kind !== where.kind || +new Date(row.updatedAt) !== +new Date(where.updatedAt)) return { count: 0 };
    rows.set(where.userId, { ...row, ...clone(data) }); writes++; return { count: 1 };
  },
} };
function mock(relative, exports) { const id = require.resolve(relative); require.cache[id] = { id, filename: id, loaded: true, exports }; }
mock("../api/_lib/db.js", db);
mock("../api/_lib/stytch.js", { authenticateSession: async token => {
  if (token !== "alice" && token !== "bob") throw Object.assign(new Error("bad"), { status: 401 });
  return { userId: token };
} });
mock("../api/_lib/mcp-keys.js", { userIdFromSession: session => session.userId });
mock("../api/_lib/log.js", { withResponseLogging: fn => fn });
const store = require("../api/_lib/exercise-workspace-store.js");
const handler = require("../api/exercise-workspace.js");
const essayBody = "1. Add validation\n2. Keep the starter blank";
const exerciseId = "api-design";
const patch = () => ({ steps: ["Add validation"], files: [{ path: "practice.ts", content: "// TODO: validate\n" }] });
async function request(action, body = {}, token = "alice") {
  let result;
  const res = { setHeader() {}, status(status) { this.code = status; return this; }, json(body) { result = { status: this.code, body }; } };
  await handler({ method: "POST", query: { action }, body, headers: token ? { authorization: "Bearer " + token } : {} }, res);
  return result;
}
async function prepare() {
  const response = await request("prepare_revision", { exerciseId, essayBody });
  assert.equal(response.status, 200);
  return response.body;
}
function args(prepared) { return { exerciseId, essayBody, baseFingerprint: prepared.baseFingerprint, revision: patch() }; }
function edit(uid, mutate) { const row = rows.get(uid); mutate(row.data); row.updatedAt = new Date(+new Date(row.updatedAt) + 10).toISOString(); }
beforeEach(() => { rows.clear(); beforeUpdate = null; writes = 0; store._resetCaches(); });

test("prepare requires owner session, validates essay, and returns bounded context without full workspace", async () => {
  for (const token of [null, "mcp_bad", "invalid"]) assert.equal((await request("prepare_revision", { exerciseId, essayBody }, token)).status, 401);
  assert.equal((await request("prepare_revision", { exerciseId, essayBody: " " })).status, 400);
  assert.equal((await request("prepare_revision", { exerciseId, essayBody: "x".repeat(12001) })).status, 400);
  const p = await prepare();
  assert.match(p.baseFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(p.workspace, undefined);
  assert.ok(p.files.length > 0 && p.files.length <= 40);
  assert.equal((await prepare()).baseFingerprint, p.baseFingerprint);
  assert.equal((await request("prepare_revision", { exerciseId: "not-owned", essayBody })).status, 404);
});

test("applies generated files to authenticated owner only and preserves latest unrelated changes", async () => {
  const p = await prepare();
  await store.listWorkspace({ userId: "bob" });
  const bob = clone(rows.get("bob"));
  edit("alice", state => { state.exercises.other = { id: "other", name: "Other", nodes: [{ id: "other-file", name: "notes.txt", type: "file", content: "keep me", parentId: null }] }; state.exerciseOrder.unshift("other"); });
  const response = await request("apply_revision", args(p));
  assert.equal(response.status, 200);
  assert.equal(response.body.changed, true);
  assert.equal(response.body.workspace.exercises.other.nodes[0].content, "keep me");
  assert.equal(response.body.workspace.exerciseOrder[0], "other");
  assert.ok(rows.get("alice").data.exercises[exerciseId].nodes.some(node => node.name === "practice.ts" && node.content.includes("TODO")));
  assert.deepEqual(rows.get("bob"), bob);
  assert.equal((await request("apply_revision", { ...args(p), userId: "bob" })).status, 400);
});

test("rejects full workspace, malformed output, unsafe paths, duplicates and excessive payloads without writes", async () => {
  const p = await prepare(); const count = writes;
  const bad = [null, {}, { steps: [], files: [] }, { ...patch(), workspace: {} }, { steps: [4], files: [] },
    { steps: Array(51).fill("x"), files: [] }, { steps: [], files: Array(25).fill({ path: "x", content: "" }) },
    ...["../escape", "/absolute", "a/../b", "a\\b", "a//b", "C:/x", "a/./b", "a\u0000b", "fixtures/a.json"].map(path => ({ steps: [], files: [{ path, content: "x" }] })),
    { steps: [], files: [{ path: "a", content: 5 }] },
    { steps: [], files: [{ path: "a", content: "x".repeat(120001) }] },
    { steps: [], files: [{ path: "a", content: "" }, { path: "A", content: "" }] },
  ];
  for (const revision of bad) assert.equal((await request("apply_revision", { ...args(p), revision })).status, 400, JSON.stringify(revision).slice(0, 150));
  assert.equal((await request("apply_revision", { ...args(p), workspace: {} })).status, 400);
  assert.equal(writes, count);
});

test("rejects stale selected exercise and altered essay without saving generated output", async () => {
  const p = await prepare();
  assert.equal((await request("apply_revision", { ...args(p), essayBody: "Different essay" })).status, 409);
  edit("alice", state => { state.exercises[exerciseId].nodes[0].content = "new owner edit"; });
  const original = clone(rows.get("alice"));
  assert.equal((await request("apply_revision", args(p))).status, 409);
  assert.deepEqual(rows.get("alice"), original);
});

test("CAS rejects a write racing between read and persistence without losing either owner's latest edits", async () => {
  const p = await prepare();
  beforeUpdate = () => edit("alice", state => { state.exercises[exerciseId].nodes[0].content = "concurrent edit"; });
  const response = await request("apply_revision", args(p));
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "revision_conflict");
  assert.equal(rows.get("alice").data.exercises[exerciseId].nodes[0].content, "concurrent edit");
  assert.ok(!rows.get("alice").data.exercises[exerciseId].nodes.some(node => node.name === "practice.ts" && node.content === "// TODO: validate\n"));
});

test("ordinary workspace edits also reject concurrent writes rather than clobber a revision", async () => {
  await prepare();
  const node = rows.get("alice").data.exercises[exerciseId].nodes.find(node => node.type === "file");
  beforeUpdate = () => edit("alice", state => { state.exercises[exerciseId].nodes.find(n => n.id === node.id).content = "new revision"; });
  const response = await request("write_file", { exerciseId, nodeId: node.id, content: "stale editor" });
  assert.equal(response.status, 409);
  assert.equal(rows.get("alice").data.exercises[exerciseId].nodes.find(n => n.id === node.id).content, "new revision");
});

test("apply cannot bootstrap another owner's workspace or bypass session auth", async () => {
  const p = await prepare();
  for (const token of [null, "mcp_bad", "invalid"]) assert.equal((await request("apply_revision", args(p), token)).status, 401);
  assert.equal((await request("apply_revision", args(p), "bob")).status, 409);
  assert.equal(rows.has("bob"), false);
});


test("prepare refuses oversized context instead of silently truncating source", async () => {
  await prepare();
  edit("alice", state => {
    const node = state.exercises[exerciseId].nodes.find(n => n.name === "README.md");
    node.content = "x".repeat(14001);
  });
  const response = await request("prepare_revision", { exerciseId, essayBody });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /too large/);
});

test("prepare keeps exact 14000-character files and refuses excess file count", async () => {
  await prepare();
  edit("alice", state => { state.exercises[exerciseId].nodes.find(n => n.name === "README.md").content = "x".repeat(14000); });
  const p = await prepare();
  assert.equal(p.files.find(f => f.path === "README.md").content, "x".repeat(14000));
  edit("alice", state => {
    for (let i = 0; i < 41; i++) state.exercises[exerciseId].nodes.push({ id: "extra-" + i, name: "extra-" + i + ".txt", type: "file", parentId: null, content: "" });
  });
  assert.equal((await request("prepare_revision", { exerciseId, essayBody })).status, 400);
});

test("prepare bounds UTF-8 bytes as well as character counts", async () => {
  await prepare();
  edit("alice", state => { state.exercises[exerciseId].nodes.forEach(node => { if (node.type === "file") node.content = "🦄".repeat(7000); }); });
  const response = await request("prepare_revision", { exerciseId, essayBody });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /too large/);
});
