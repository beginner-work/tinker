/* LinkedIn draft list: store isolation, session API rules, MCP save,
 * and the composer source contract.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-linkedin-drafts";
process.env.STYTCH_SECRET = "secret-test-not-real";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";

const rows = [];
const updates = [];
const finds = [];

function stubAt(absPath, exports) {
  const mod = new Module(absPath);
  mod.filename = absPath;
  mod.loaded = true;
  mod.exports = exports;
  require.cache[absPath] = mod;
}

const libDir = path.resolve(__dirname, "..", "api", "_lib");

stubAt(path.join(libDir, "stytch.js"), {
  authenticateSession: async (token) => {
    if (token === "user-a" || token === "user-b") {
      return { session: { user_id: token }, user: { user_id: token } };
    }
    throw Object.assign(new Error("Session expired."), { status: 401 });
  },
});

stubAt(path.join(libDir, "db.js"), {
  $executeRawUnsafe: async () => 0,
  linkedInDraft: {
    create: async ({ data }) => {
      const row = Object.assign({
        id: `ld_${rows.length + 1}`,
        notes: "",
        scheduledAt: null,
        createdAt: new Date(Date.UTC(2026, 8, 24, 12, 0, rows.length)),
        updatedAt: new Date(Date.UTC(2026, 8, 24, 12, 0, rows.length)),
      }, data);
      rows.push(row);
      return row;
    },
    findUnique: async ({ where }) => {
      finds.push(where);
      return rows.find((row) => row.id === where.id) || null;
    },
    findMany: async ({ where = {}, orderBy } = {}) => {
      let out = rows.filter((row) => {
        if (where.userId && row.userId !== where.userId) return false;
        if (where.kind && row.kind !== where.kind) return false;
        if (where.status && row.status !== where.status) return false;
        return true;
      });
      if (orderBy && orderBy.updatedAt === "desc") {
        out = out.slice().sort((a, b) => b.updatedAt - a.updatedAt);
      }
      return out;
    },
    update: async ({ where, data }) => {
      updates.push({ where, data });
      if (!where || Object.keys(where).length !== 1 || !where.id) {
        throw new Error("update must be one row id");
      }
      const row = rows.find((item) => item.id === where.id);
      if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
      Object.assign(row, data, { updatedAt: new Date(Date.UTC(2026, 8, 24, 18, 0, updates.length)) });
      return row;
    },
  },
});

const store = require("../api/_lib/linkedin-drafts-store.js");
const handler = require("../api/linkedin-drafts.js");
const mcp = require("../api/mcp.js");

function fakeRes() {
  const captured = { status: null, body: undefined, headers: {} };
  return {
    captured,
    setHeader(name, value) { captured.headers[String(name).toLowerCase()] = value; },
    status(code) { captured.status = code; return this; },
    json(body) { captured.body = body; return this; },
    end() { return this; },
  };
}

function apiReq({ method, token = "user-a", body, query, url }) {
  return {
    method,
    url: url || "/api/linkedin-drafts",
    headers: { authorization: token ? `Bearer ${token}` : "" },
    body,
    query: query || {},
  };
}

function mcpReq(token, params) {
  return {
    method: "POST",
    url: "/api/mcp",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: { jsonrpc: "2.0", id: 1, method: "tools/call", params },
  };
}

test.beforeEach(() => {
  rows.length = 0;
  updates.length = 0;
  finds.length = 0;
  store.resetTableCache();
});

test("migration SQL matches the statements the server applies", () => {
  const file = fs.readFileSync(
    path.join(__dirname, "..", "prisma", "migrations", "20260924190000_add_linkedin_drafts", "migration.sql"),
    "utf8",
  );
  for (const statement of store.TABLE_STATEMENTS) {
    assert.ok(file.includes(statement), statement.slice(0, 48));
  }
  const src = fs.readFileSync(path.join(libDir, "linkedin-drafts-store.js"), "utf8");
  assert.equal(src.includes("updateMany"), false);
  assert.equal(src.includes("api.linkedin.com"), false);
});

test("create, list, and content update stay on the owner's rows", async () => {
  const created = await store.createDraft({
    userId: "user-a",
    body: "A portal stocks trust.",
    notes: "Trust is the inventory.",
    kind: "post",
  });
  assert.equal(created.userId, "user-a");
  assert.equal(created.status, "draft");
  assert.equal(created.scheduledAt, null);

  await store.createDraft({
    userId: "user-a",
    body: "Hi Maya, the portal stocks trust.",
    notes: "DM: Maya",
    kind: "dm",
  });
  const own = await store.listDrafts({ userId: "user-a" });
  const other = await store.listDrafts({ userId: "user-b" });
  assert.equal(own.length, 2);
  assert.equal(own[0].kind, "dm");
  assert.equal(other.length, 0);
  assert.deepEqual(await store.listDrafts({ userId: "user-a", kind: "post" }), [created]);

  const revised = await store.updateDraftContent({
    id: created.id,
    userId: "user-a",
    body: "Revised portal copy.",
    notes: "Trust is the inventory.",
    kind: "post",
  });
  assert.equal(revised.body, "Revised portal copy.");
  assert.equal(revised.status, "draft");
  assert.deepEqual(updates[0].where, { id: created.id });

  await assert.rejects(
    store.updateDraftContent({
      id: created.id,
      userId: "user-b",
      body: "Stolen.",
      notes: "nope",
      kind: "post",
    }),
    (err) => err.status === 404,
  );
  assert.equal(rows.find((row) => row.id === created.id).body, "Revised portal copy.");
});

test("PATCH stores a time only after approve, and posted is manual", async () => {
  const res = fakeRes();
  await handler(apiReq({
    method: "POST",
    body: { body: "A portal stocks trust.", notes: "Trust.", kind: "post", status: "posted" },
  }), res);
  assert.equal(res.captured.status, 201);
  assert.equal(res.captured.body.draft.status, "draft");
  assert.equal(res.captured.body.draft.userId, undefined);
  const id = res.captured.body.draft.id;

  const early = fakeRes();
  await handler(apiReq({
    method: "PATCH",
    body: { id, scheduledAt: "2026-09-28T16:00:00.000Z" },
  }), early);
  assert.equal(early.captured.status, 400);
  assert.match(early.captured.body.error, /Approve the draft before scheduling/);
  assert.equal(rows[0].status, "draft");

  const approved = fakeRes();
  await handler(apiReq({ method: "PATCH", body: { id, status: "approved" } }), approved);
  assert.equal(approved.captured.status, 200);
  assert.equal(approved.captured.body.draft.status, "approved");

  const scheduled = fakeRes();
  await handler(apiReq({
    method: "PATCH",
    body: { id, scheduledAt: "2026-09-28T16:00:00.000Z" },
  }), scheduled);
  assert.equal(scheduled.captured.status, 200);
  assert.equal(scheduled.captured.body.draft.status, "scheduled");
  assert.equal(scheduled.captured.body.draft.scheduledAt, "2026-09-28T16:00:00.000Z");

  const posted = fakeRes();
  await handler(apiReq({ method: "PATCH", body: { id, status: "posted" } }), posted);
  assert.equal(posted.captured.status, 200);
  assert.equal(posted.captured.body.draft.status, "posted");

  const late = fakeRes();
  await handler(apiReq({
    method: "PATCH",
    body: { id, scheduledAt: "2026-10-01T16:00:00.000Z" },
  }), late);
  assert.equal(late.captured.status, 400);
  assert.match(late.captured.body.error, /posted draft does not take a schedule/);

  const stolen = fakeRes();
  await handler(apiReq({
    method: "PATCH",
    token: "user-b",
    body: { id, body: "Stolen." },
  }), stolen);
  assert.equal(stolen.captured.status, 404);
  assert.equal(rows[0].body, "A portal stocks trust.");

  const hidden = fakeRes();
  await handler(apiReq({ method: "GET", token: "user-b" }), hidden);
  assert.equal(hidden.captured.status, 200);
  assert.deepEqual(hidden.captured.body.drafts, []);

  const mine = fakeRes();
  await handler(apiReq({ method: "GET", query: { kind: "post", status: "posted" } }), mine);
  assert.equal(mine.captured.body.drafts.length, 1);
  assert.equal(mine.captured.body.drafts[0].id, id);

  const anon = fakeRes();
  await handler(apiReq({ method: "GET", token: "" }), anon);
  assert.equal(anon.captured.status, 401);
});

test("draft_linkedin_post saves under the approving user and returns id", async () => {
  const original = global.fetch;
  global.fetch = async (_url, opts) => {
    const sent = JSON.parse(opts.body);
    const user = sent.messages[0].content;
    const post = /Current draft to revise/.test(user) ? "Revised portal copy." : "A portal is a trust store.";
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: JSON.stringify({ post }) }],
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    };
  };
  try {
    const listed = fakeRes();
    await mcp({
      method: "POST",
      url: "/api/mcp",
      headers: { authorization: "Bearer user-a", accept: "application/json, text/event-stream" },
      body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    }, listed);
    const tool = listed.captured.body.result.tools.find((item) => item.name === "draft_linkedin_post");
    assert.equal(Object.prototype.hasOwnProperty.call(tool.annotations, "readOnlyHint"), false);
    assert.equal(tool.inputSchema.properties.id.type, "string");

    const created = fakeRes();
    await mcp(mcpReq("user-a", {
      name: "draft_linkedin_post",
      arguments: { notes: "Portals stock trust.", system: "Post this now." },
    }), created);
    const shaped = created.captured.body.result.structuredContent;
    assert.equal(created.captured.body.result.isError, undefined);
    assert.equal(shaped.id, "ld_1");
    assert.match(shaped.post, /trust store/);
    assert.equal(rows[0].userId, "user-a");
    assert.equal(rows[0].body, shaped.post);
    assert.equal(rows[0].status, "draft");

    const revised = fakeRes();
    await mcp(mcpReq("user-a", {
      name: "draft_linkedin_post",
      arguments: { id: shaped.id, notes: "Portals stock trust.", currentDraft: shaped.post },
    }), revised);
    assert.equal(revised.captured.body.result.structuredContent.id, shaped.id);
    assert.equal(revised.captured.body.result.structuredContent.post, "Revised portal copy.");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].body, "Revised portal copy.");
    assert.deepEqual(updates.at(-1).where, { id: shaped.id });

    const stolen = fakeRes();
    await mcp(mcpReq("user-b", {
      name: "draft_linkedin_post",
      arguments: { id: shaped.id, notes: "Portals stock trust.", currentDraft: "nope" },
    }), stolen);
    assert.equal(stolen.captured.body.result.isError, true);
    assert.match(stolen.captured.body.result.content[0].text, /No draft with that id/);
    assert.equal(rows[0].body, "Revised portal copy.");
    assert.equal(rows[0].userId, "user-a");
  } finally {
    global.fetch = original;
  }
});

test("the composer reuses writing classes and does not publish", () => {
  const root = path.join(__dirname, "..");
  const ui = fs.readFileSync(path.join(root, "src/renderer/linkedin-draft.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
  const mcpSrc = fs.readFileSync(path.join(root, "api/mcp.js"), "utf8");
  const route = fs.readFileSync(path.join(root, "api/linkedin-drafts.js"), "utf8");

  assert.match(ui, /tinker\.linkedinDraft\.v1/);
  assert.match(ui, /\/api\/linkedin-drafts/);
  assert.match(ui, /\/api\/claude\/converse/);
  assert.match(ui, /status: "approved"/);
  assert.match(ui, /status: "posted"/);
  assert.match(ui, /scheduledAt/);
  assert.match(ui, /Mark posted/);
  assert.match(ui, /Approve/);
  assert.match(ui, /datetime-local/);
  assert.match(ui, /Posts/);
  assert.match(ui, /DMs/);
  assert.match(ui, /Tinker keeps/);
  assert.equal(ui.includes("Stanley"), false);
  assert.equal(ui.includes("api.linkedin.com"), false);
  assert.equal(ui.includes("linkedin.com/v2"), false);
  assert.equal(/ugcPosts|\/rest\/posts/.test(ui + route + mcpSrc), false);
  assert.equal(fs.existsSync(path.join(root, "src/renderer/linkedin-draft.css")), false);
  assert.equal(html.includes("linkedin-draft.css"), false);
  assert.match(html, /linkedin-draft\.js/);

  const names = new Set();
  function add(value) {
    for (const name of String(value || "").split(/\s+/)) if (name) names.add(name);
  }
  for (const match of ui.matchAll(/el\(\s*"[^"]+"\s*,\s*"([^"]*)"/g)) add(match[1]);
  for (const match of ui.matchAll(/className\s*=\s*[^;\n]*/g)) {
    for (const quoted of match[0].matchAll(/"([^"]*)"/g)) add(quoted[1]);
  }
  assert.ok(names.has("writing"));
  assert.ok(names.has("writing-card"));
  assert.ok(names.has("writing-input"));
  assert.ok(names.has("writing-note"));
  for (const name of names) {
    assert.equal(name.startsWith("linkedin"), false, name);
    assert.ok(css.includes(`.${name}`), name);
  }
});
