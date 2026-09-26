/* Interview decks: store isolation, idempotent save, session GET, MCP tool.
 *
 * Tyler's TYL-22 answers: transcript only (no slides), interviewKey as
 * the idempotency key, own deck GET is 200, someone else's id is 404.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-interview-decks";
process.env.STYTCH_SECRET = "secret-test-not-real";
process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";

const rows = [];
const creates = [];
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
  interviewDeck: {
    create: async ({ data }) => {
      creates.push(data);
      const clash = rows.find(
        (row) => row.userId === data.userId && row.interviewKey === data.interviewKey,
      );
      if (clash) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const row = Object.assign({
        id: `deck_${rows.length + 1}`,
        createdAt: new Date(Date.UTC(2026, 8, 26, 12, 0, rows.length)),
        updatedAt: new Date(Date.UTC(2026, 8, 26, 12, 0, rows.length)),
      }, data);
      rows.push(row);
      return row;
    },
    findUnique: async ({ where }) => {
      finds.push(where);
      if (where.id) return rows.find((row) => row.id === where.id) || null;
      if (where.userId_interviewKey) {
        const pair = where.userId_interviewKey;
        return rows.find(
          (row) => row.userId === pair.userId && row.interviewKey === pair.interviewKey,
        ) || null;
      }
      return null;
    },
    findMany: async ({ where = {}, orderBy } = {}) => {
      let out = rows.filter((row) => {
        if (where.userId && row.userId !== where.userId) return false;
        return true;
      });
      if (orderBy && orderBy.updatedAt === "desc") {
        out = out.slice().sort((a, b) => b.updatedAt - a.updatedAt);
      }
      return out;
    },
  },
});

const store = require("../api/_lib/interview-decks-store.js");
const handler = require("../api/interview-decks.js");
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

function apiReq({ method = "GET", token = "user-a", query, url } = {}) {
  return {
    method,
    url: url || "/api/interview-decks",
    headers: { authorization: token ? `Bearer ${token}` : "" },
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

const SAMPLE = {
  topic: "Where I am this week",
  interviewKey: "ivw_portal_1",
  transcript: [
    { q: "Where are you?", a: "In the portal work." },
    { q: "What are you learning?", a: "Trust is the inventory." },
  ],
};

test.beforeEach(() => {
  rows.length = 0;
  creates.length = 0;
  finds.length = 0;
  store.resetTableCache();
});

test("migration SQL matches the statements the server applies", () => {
  const file = fs.readFileSync(
    path.join(__dirname, "..", "prisma", "migrations", "20260926150000_add_interview_decks", "migration.sql"),
    "utf8",
  );
  for (const statement of store.TABLE_STATEMENTS) {
    assert.ok(file.includes(statement), statement.slice(0, 48));
  }
  const src = fs.readFileSync(path.join(libDir, "interview-decks-store.js"), "utf8");
  assert.equal(/\bslides?\b/i.test(src) && !/no slides/i.test(src), false);
  assert.equal(src.includes("PowerPoint"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(
    require("../api/_lib/interview-decks-store.js"),
    "saveSlides",
  ), false);
});

test("save is idempotent on interviewKey and isolates users", async () => {
  const first = await store.saveDeck({
    userId: "user-a",
    topic: SAMPLE.topic,
    transcript: SAMPLE.transcript,
    interviewKey: SAMPLE.interviewKey,
  });
  assert.equal(first.userId, "user-a");
  assert.equal(first.interviewKey, SAMPLE.interviewKey);
  assert.equal(first.transcript.length, 2);

  const retry = await store.saveDeck({
    userId: "user-a",
    topic: "Different topic on retry",
    transcript: [{ q: "Changed?", a: "Should not overwrite." }],
    interviewKey: SAMPLE.interviewKey,
  });
  assert.equal(retry.id, first.id);
  assert.equal(retry.topic, SAMPLE.topic);
  assert.equal(retry.transcript[1].a, "Trust is the inventory.");
  assert.equal(rows.length, 1);
  assert.equal(creates.length, 1);

  await store.saveDeck({
    userId: "user-b",
    topic: SAMPLE.topic,
    transcript: SAMPLE.transcript,
    interviewKey: SAMPLE.interviewKey,
  });
  assert.equal(rows.length, 2);

  const own = await store.listDecks({ userId: "user-a" });
  const other = await store.listDecks({ userId: "user-b" });
  assert.equal(own.length, 1);
  assert.equal(other.length, 1);
  assert.equal(own[0].id, first.id);
  assert.notEqual(other[0].id, first.id);
});

test("someone else's deck id returns 404, own deck GET is 200", async () => {
  const created = await store.saveDeck({
    userId: "user-a",
    topic: SAMPLE.topic,
    transcript: SAMPLE.transcript,
    interviewKey: SAMPLE.interviewKey,
  });

  const mine = fakeRes();
  await handler(apiReq({ query: { id: created.id } }), mine);
  assert.equal(mine.captured.status, 200);
  assert.equal(mine.captured.body.deck.id, created.id);
  assert.equal(mine.captured.body.deck.topic, SAMPLE.topic);
  assert.equal(mine.captured.body.deck.transcript.length, 2);
  assert.equal(mine.captured.body.deck.userId, undefined);

  const stolen = fakeRes();
  await handler(apiReq({ token: "user-b", query: { id: created.id } }), stolen);
  assert.equal(stolen.captured.status, 404);
  assert.match(stolen.captured.body.error, /No deck with that id/);

  await assert.rejects(
    store.getDeck({ id: created.id, userId: "user-b" }),
    (err) => err.status === 404,
  );

  const listed = fakeRes();
  await handler(apiReq({}), listed);
  assert.equal(listed.captured.status, 200);
  assert.equal(listed.captured.body.decks.length, 1);
  assert.equal(listed.captured.body.decks[0].turnCount, 2);
  assert.equal(listed.captured.body.decks[0].transcript, undefined);

  const anon = fakeRes();
  await handler(apiReq({ token: "" }), anon);
  assert.equal(anon.captured.status, 401);
});

test("save_interview_deck stores under the approving user and retries safely", async () => {
  const listed = fakeRes();
  await mcp({
    method: "POST",
    url: "/api/mcp",
    headers: { authorization: "Bearer user-a", accept: "application/json, text/event-stream" },
    body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
  }, listed);
  const tool = listed.captured.body.result.tools.find((item) => item.name === "save_interview_deck");
  assert.ok(tool);
  assert.equal(tool.annotations.readOnlyHint, false);
  assert.deepEqual(tool.inputSchema.required, ["topic", "transcript", "interviewKey"]);
  assert.match(tool.description, /idempotency key/i);
  assert.match(tool.description, /does not call a model/i);
  assert.match(tool.description, /no slides/i);
  assert.equal(tool.inputSchema.properties.slides, undefined);

  const created = fakeRes();
  await mcp(mcpReq("user-a", {
    name: "save_interview_deck",
    arguments: SAMPLE,
  }), created);
  const shaped = created.captured.body.result.structuredContent;
  assert.equal(created.captured.body.result.isError, undefined);
  assert.equal(shaped.id, "deck_1");
  assert.equal(shaped.topic, SAMPLE.topic);
  assert.equal(shaped.interviewKey, SAMPLE.interviewKey);
  assert.equal(shaped.turnCount, 2);
  assert.equal(rows[0].userId, "user-a");

  const retry = fakeRes();
  await mcp(mcpReq("user-a", {
    name: "save_interview_deck",
    arguments: {
      topic: "Retry topic",
      interviewKey: SAMPLE.interviewKey,
      transcript: [{ q: "x", a: "y" }],
    },
  }), retry);
  assert.equal(retry.captured.body.result.structuredContent.id, shaped.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].topic, SAMPLE.topic);

  const bad = fakeRes();
  await mcp(mcpReq("user-a", {
    name: "save_interview_deck",
    arguments: { topic: "Missing key", transcript: SAMPLE.transcript },
  }), bad);
  assert.equal(bad.captured.body.result.isError, true);
  assert.match(bad.captured.body.result.content[0].text, /interviewKey/);
});

test("the panel reuses writing classes and stays read-only", () => {
  const root = path.join(__dirname, "..");
  const ui = fs.readFileSync(path.join(root, "src/renderer/interview-decks.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
  const route = fs.readFileSync(path.join(root, "api/interview-decks.js"), "utf8");

  assert.match(ui, /\/api\/interview-decks/);
  assert.match(ui, /nav-interview-decks/);
  assert.match(ui, /save_interview_deck/);
  assert.match(ui, /Read-only/);
  assert.equal(ui.includes("method: \"POST\""), false);
  assert.equal(ui.includes("method: \"PATCH\""), false);
  assert.equal(/\bPOST\b/.test(route.replace(/\/\*[\s\S]*?\*\//g, "")), false);
  assert.equal(fs.existsSync(path.join(root, "src/renderer/interview-decks.css")), false);
  assert.match(html, /interview-decks\.js/);
  assert.match(html, /id="nav-interview-decks"/);

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
  assert.ok(names.has("writing-note"));
  for (const name of names) {
    assert.equal(name.startsWith("interview"), false, name);
    assert.ok(css.includes(`.${name}`), name);
  }
});
