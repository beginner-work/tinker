/* TYL-56 story parts: check_text gate + MCP read tools. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-story-gate";
process.env.STYTCH_SECRET = "secret-test-not-real";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";

let seq = 0;
const tables = {};
function model() {
  const rows = [];
  return {
    rows,
    async create({ data }) {
      if (data.draftKey && rows.some((r) => r.userId === data.userId && r.draftKey === data.draftKey)) {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      }
      if (data.kind && rows.some((r) => r.userId === data.userId && r.kind === data.kind)) {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      }
      const now = new Date(Date.UTC(2026, 8, 29, 2, 0, ++seq));
      const row = Object.assign({ id: "row_" + seq, createdAt: now, updatedAt: now }, data);
      rows.push(row);
      return row;
    },
    async findUnique({ where }) {
      if (where.id) return rows.find((r) => r.id === where.id) || null;
      const pair = where.userId_draftKey || where.userId_kind;
      if (!pair) return null;
      if (where.userId_draftKey) return rows.find((r) => r.userId === pair.userId && r.draftKey === pair.draftKey) || null;
      return rows.find((r) => r.userId === pair.userId && r.kind === pair.kind) || null;
    },
    async findMany({ where = {} } = {}) {
      return rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
    },
    async update({ where, data }) {
      const row = rows.find((r) => r.id === where.id);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
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
for (const name of ["storyPart", "storyPartEvent", "tinkerUserData", "contentItem"]) tables[name] = model();
const database = {
  $executeRawUnsafe: async () => 0,
  $transaction: async (fn) => fn(database),
  storyPart: tables.storyPart,
  storyPartEvent: tables.storyPartEvent,
  tinkerUserData: tables.tinkerUserData,
  contentItem: tables.contentItem,
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
for (const rel of ["story-parts-store.js", "db.js", "stytch.js", "mcp-keys.js", "career.js", "career-check.js"]) {
  delete require.cache[path.join(libDir, rel)];
}
delete require.cache[path.join(apiDir, "story-parts.js")];
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
    if (token === "mcp_" + "a".repeat(43)) return { id: "k1", label: "formation", userId: "user-a" };
    if (token === "mcp_" + "b".repeat(43)) return { id: "k2", label: "other", userId: "user-b" };
    throw Object.assign(new Error("Invalid API key."), { status: 401 });
  },
  userIdFromSession: (s) => (s && s.session && s.session.user_id) || "",
});

const store = require("../api/_lib/story-parts-store.js");
const owner = require("../api/story-parts.js");
const mcp = require("../api/mcp.js");

const PASS = { ready: true, claims: [{ text: "Stripe", kind: "employer", verdict: "pass", fact_id: "f1" }], unverified_note: "ok" };
const FAIL = { ready: false, claims: [{ text: "invented unicorn", kind: "employer", verdict: "unsupported" }], unverified_note: "ok" };

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
async function call({ method, token = "user-a", action, body, query }) {
  const res = fakeRes();
  await owner({
    method, url: "/api/story-parts",
    headers: { authorization: "Bearer " + token },
    body, query: Object.assign({ action }, query || {}),
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
  for (const table of Object.values(tables)) table.rows.length = 0;
  store.resetTableCache();
  store.setFactGate(async () => PASS);
});

test("proof_point gate blocks, other stages skip check_text, and MCP is ready-only and isolated", async () => {
  store.setFactGate(async () => FAIL);
  const proof = await call({
    method: "POST", action: "create",
    body: {
      stageKey: "proof_point", title: "ARR", body: "I founded an invented unicorn.",
      fields: { start: "0", number: "1M", cause: "magic" }, topics: ["fintech"],
      concepts: ["trust-boundaries"], stack: ["TypeScript"], sourceKind: "none",
    },
  });
  assert.equal(proof.status, 201);
  const blocked = await call({ method: "POST", action: "status", body: { id: proof.body.part.id, status: "ready" } });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.body.verdict.ready, false);
  assert.equal(tables.storyPart.rows.find((r) => r.id === proof.body.part.id).status, "draft");

  await call({ method: "PATCH", action: "edit", body: { id: proof.body.part.id, body: "I worked at Stripe." } });
  store.setFactGate(async () => PASS);
  const ok = await call({ method: "POST", action: "status", body: { id: proof.body.part.id, status: "ready" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.part.status, "ready");
  assert.equal(ok.body.verdict.ready, true);
  assert.ok(ok.body.part.checkedAt);

  let gateCalls = 0;
  store.setFactGate(async () => { gateCalls += 1; return FAIL; });
  const hook = await call({
    method: "POST", action: "create",
    body: { stageKey: "hook", title: "Curious", body: "A soft claim.", topics: ["developers"], sourceKind: "none" },
  });
  const skipped = await call({ method: "POST", action: "status", body: { id: hook.body.part.id, status: "ready" } });
  assert.equal(skipped.status, 200);
  assert.equal(skipped.body.part.status, "ready");
  assert.equal(skipped.body.verdict, null);
  assert.deepEqual(skipped.body.part.checkVerdicts || [], []);
  assert.equal(skipped.body.part.checkedAt == null, true);
  assert.equal(gateCalls, 0);

  const draftOnly = await call({
    method: "POST", action: "create",
    body: { stageKey: "ask", title: "Ask", body: "Fifteen minutes.", topics: ["intro"], sourceKind: "none" },
  });

  store.setFactGate(async () => PASS);
  const codePart = await call({
    method: "POST", action: "create",
    body: {
      stageKey: "proof_point", title: "The store", body: "Tables hold the truth.",
      concepts: ["source-of-truth"], stack: ["Prisma", "MCP"],
      sourceKind: "code",
      sourceRef: { repo: "example/widget", path: "api/store.js", ref: "main", evidence: ["api/store.js", "tests/store.test.js"] },
    },
  });
  assert.equal(codePart.status, 201);
  await call({ method: "POST", action: "status", body: { id: codePart.body.part.id, status: "ready" } });

  const fit = await call({
    method: "POST", action: "create",
    body: {
      stageKey: "fit", title: "Platform lead", body: "For platform teams.",
      fields: { teamOrRole: "platform lead" }, concepts: ["trust-boundaries"], sourceKind: "none",
    },
  });
  await call({ method: "POST", action: "status", body: { id: fit.body.part.id, status: "ready" } });

  const bot = "mcp_" + "a".repeat(43);
  const other = "mcp_" + "b".repeat(43);
  const listed = fakeRes();
  await mcp({ method: "POST", headers: { authorization: "Bearer " + bot }, body: { jsonrpc: "2.0", id: 9, method: "tools/list" } }, listed);
  const names = listed.captured.body.result.tools.map((t) => t.name);
  assert.ok(names.includes("list_story_parts") && names.includes("get_story_part"));
  assert.equal(names.includes("list_story_stages"), false);
  const listTool = listed.captured.body.result.tools.find((t) => t.name === "list_story_parts");
  assert.match(listTool.description, /Formation/);
  assert.match(listTool.description, /hook, proof_point, connecting_story, fit, ask/);
  assert.match(listTool.description, /the user stands behind/i);
  assert.equal(/Tyler can prove/i.test(listTool.description), false);
  assert.match(listTool.description, /does not draft or send/i);
  assert.deepEqual(Object.keys(listTool.inputSchema.properties).sort(), ["concepts", "stage", "teamOrRole"]);
  assert.equal(listed.captured.body.result.tools.some((t) => /draft_outreach|list_threads|approve_story/i.test(t.name)), false);
  assert.equal(listed.captured.body.result.tools.some((t) => t.name === "list_story_stages"), false);

  const parts = await mcpCall(bot, "list_story_parts", { stage: "proof_point", concepts: "trust-boundaries" });
  assert.equal(parts.body.result.structuredContent.parts.length, 1);
  assert.equal(parts.body.result.structuredContent.parts[0].id, proof.body.part.id);
  assert.equal(parts.body.result.structuredContent.parts[0].stage, "proof_point");
  assert.deepEqual(parts.body.result.structuredContent.parts[0].concepts, ["trust-boundaries"]);
  assert.deepEqual(parts.body.result.structuredContent.parts[0].stack, ["typescript"]);
  assert.deepEqual(parts.body.result.structuredContent.parts[0].source, { kind: "none", id: null });
  assert.equal(parts.body.result.structuredContent.parts[0].sourceChanged, undefined);
  assert.equal(parts.body.result.structuredContent.parts[0].source.title, undefined);

  const byConcept = await mcpCall(bot, "list_story_parts", { concepts: "source-of-truth" });
  assert.equal(byConcept.body.result.structuredContent.parts.length, 1);
  assert.equal(byConcept.body.result.structuredContent.parts[0].id, codePart.body.part.id);
  assert.deepEqual(byConcept.body.result.structuredContent.parts[0].source, { kind: "code", id: null });
  assert.deepEqual(byConcept.body.result.structuredContent.parts[0].sourceRef, {
    repo: "example/widget", path: "api/store.js", ref: "main", evidence: ["api/store.js", "tests/store.test.js"],
  });

  const byRole = await mcpCall(bot, "list_story_parts", { teamOrRole: "platform lead" });
  assert.equal(byRole.body.result.structuredContent.parts.length, 1);
  assert.equal(byRole.body.result.structuredContent.parts[0].id, fit.body.part.id);

  const defaultReady = await mcpCall(bot, "list_story_parts", {});
  assert.ok(defaultReady.body.result.structuredContent.parts.every((p) => p.id !== draftOnly.body.part.id));
  const draftOverride = await mcpCall(bot, "list_story_parts", { status: "draft" });
  assert.equal(draftOverride.body.result.structuredContent.parts.some((p) => p.id === draftOnly.body.part.id), false);
  assert.ok(draftOverride.body.result.structuredContent.parts.every((p) => {
    const row = tables.storyPart.rows.find((r) => r.id === p.id);
    return row && row.status === "ready";
  }));
  assert.equal(listTool.inputSchema.properties.status, undefined);
  assert.equal(listTool.inputSchema.properties.stack, undefined);
  assert.equal(listTool.inputSchema.properties.q, undefined);
  assert.equal(listTool.inputSchema.properties.limit, undefined);

  const one = await mcpCall(bot, "get_story_part", { id: proof.body.part.id });
  assert.equal(one.body.result.structuredContent.part.fields.number, "1M");
  assert.deepEqual(one.body.result.structuredContent.part.concepts, ["trust-boundaries"]);
  assert.ok(Array.isArray(one.body.result.structuredContent.part.checkVerdicts));
  assert.deepEqual(one.body.result.structuredContent.part.source, { kind: "none", id: null });

  const codeGet = await mcpCall(bot, "get_story_part", { id: codePart.body.part.id });
  assert.deepEqual(codeGet.body.result.structuredContent.part.sourceRef.evidence, ["api/store.js", "tests/store.test.js"]);
  assert.deepEqual(codeGet.body.result.structuredContent.part.stack, ["prisma", "mcp"]);

  assert.deepEqual((await mcpCall(other, "list_story_parts", {})).body.result.structuredContent.parts, []);
  const stolen = await mcpCall(other, "get_story_part", { id: proof.body.part.id });
  assert.equal(stolen.body.result.isError, true);
  assert.match(stolen.body.result.content[0].text, /No part/);

  await call({ method: "PATCH", action: "edit", body: { id: proof.body.part.id, body: "Edited ready part." } });
  const afterEdit = await mcpCall(bot, "list_story_parts", { stage: "proof_point", concepts: "trust-boundaries" });
  assert.equal(afterEdit.body.result.structuredContent.parts.length, 0);
});
