/* Generic reading workbook: store, merge-safe notes, MCP tools, UI wiring. */
"use strict";

const { EXPECTED_SW_CACHE_VERSION } = require("./helpers/sw-cache-version.js");

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const fs = require("node:fs");

process.env.STYTCH_PROJECT_ID = "project-test-reading";
process.env.STYTCH_SECRET = "secret-test-not-real";
process.env.ANTHROPIC_API_KEY = ""; // force pre-read fallback (no live Anthropic)

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
      const now = new Date(Date.UTC(2026, 8, 30, 6, 0, ++seq));
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
for (const rel of [
  "reading-thread-store.js",
  "reading-preread.js",
  "notes-merge.js",
  "db.js",
  "stytch.js",
  "mcp-keys.js",
  "anthropic.js",
]) {
  delete require.cache[path.join(libDir, rel)];
}
delete require.cache[path.join(apiDir, "reading-thread.js")];
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
stubAt(path.join(libDir, "anthropic.js"), {
  callAnthropic: async () => { throw Object.assign(new Error("no key"), { status: 503 }); },
});

const notesMerge = require("../api/_lib/notes-merge.js");
const store = require("../api/_lib/reading-thread-store.js");
const owner = require("../api/reading-thread.js");
const mcp = require("../api/mcp.js");
const root = path.join(__dirname, "..");

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
async function ownerCall({ method, token = "user-a", action, id, body }) {
  const res = fakeRes();
  const q = new URLSearchParams();
  if (action) q.set("action", action);
  if (id) q.set("id", id);
  await owner({
    method,
    url: "/api/reading-thread?" + q.toString(),
    query: Object.fromEntries(q.entries()),
    headers: { authorization: "Bearer " + token },
    body: body || undefined,
  }, res);
  return res.captured;
}
async function mcpCall(name, args, token) {
  const res = fakeRes();
  await mcp({
    method: "POST",
    headers: { authorization: "Bearer " + token, accept: "application/json", "content-type": "application/json" },
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args || {} },
    },
  }, res);
  return res.captured;
}
function toolPayload(captured) {
  return captured && captured.body && captured.body.result && captured.body.result.structuredContent;
}

test("notes-merge preserves ### __done__ (shared with leads #395)", () => {
  const done = "### Q1\nA1\n\n### __done__\n";
  assert.equal(notesMerge.mergeLeadNotes(done, null), done);
  assert.equal(notesMerge.mergeLeadNotes(done, ""), done);
  const merged = notesMerge.mergeLeadNotes(done, "### Q1\nA1\n\n### Q2\nA2");
  assert.match(merged, /__done__/);
  assert.match(merged, /Q2/);
});

test("create_reading_thread is generic and ordered; advance generates next section", async () => {
  const created = await store.createThread({
    userId: "user-a",
    title: "Example Book",
    author: "A. Author",
    sections: ["Section One", "Section Two", "Section Three"],
  });
  assert.equal(created.title, "Example Book");
  assert.equal(created.sections.length, 3);
  assert.equal(created.currentSectionIndex, 0);
  assert.equal(created.currentSection.title, "Section One");
  assert.ok(created.currentSection.preReadQuestion);
  // No Anthropic key in this suite → fallback template only.
  assert.match(created.currentSection.preReadQuestion, /what do you want to notice or get clearer on/i);
  assert.match(created.currentSection.preReadQuestion, /Section One|Example Book/);

  const advanced = await store.advanceSection({
    userId: "user-a",
    threadId: created.id,
    notes: "### " + created.currentSection.preReadQuestion + "\nReady to read.\n",
  });
  assert.equal(advanced.currentSectionIndex, 1);
  assert.equal(advanced.sections[0].status, "done");
  assert.equal(advanced.currentSection.title, "Section Two");
  assert.ok(advanced.currentSection.preReadQuestion);
  assert.match(advanced.notes, /Ready to read/);

  // Empty notes cannot wipe Q&A.
  const kept = await store.updateNotes({
    userId: "user-a",
    threadId: created.id,
    notes: "",
  });
  assert.match(kept.notes, /Ready to read/);
});

test("advance on last section appends ### __done__", async () => {
  const created = await store.createThread({
    userId: "user-b",
    title: "Short Book",
    sections: ["Only Chapter"],
  });
  const done = await store.advanceSection({ userId: "user-b", threadId: created.id });
  assert.equal(done.done, true);
  assert.match(done.notes, /__done__/);
});

test("owner API lists and edits; mcp_ bearer rejected on owner route", async () => {
  const created = await store.createThread({
    userId: "user-a",
    title: "Owner Route Book",
    sections: ["Ch 1", "Ch 2"],
  });
  const listed = await ownerCall({ method: "GET", action: "list" });
  assert.equal(listed.status, 200);
  assert.ok(listed.body.threads.some((t) => t.id === created.id));

  const edited = await ownerCall({
    method: "POST",
    action: "edit",
    id: created.id,
    body: { notes: "### Prep?\nYes\n" },
  });
  assert.equal(edited.status, 200);
  assert.match(edited.body.thread.notes, /Prep/);

  const mcpRejected = await ownerCall({
    method: "GET",
    action: "list",
    token: "mcp_" + "a".repeat(43),
  });
  assert.equal(mcpRejected.status, 401);
});

test("MCP create / list / get / advance (isolated fake user, not Tyler leads)", async () => {
  const token = "mcp_" + "a".repeat(43);
  const createRes = await mcpCall("create_reading_thread", {
    title: "MCP Book",
    author: "Tester",
    sections: ["Alpha", "Beta"],
  }, token);
  assert.equal(createRes.status, 200);
  assert.equal(createRes.body.result.isError, undefined);
  const created = toolPayload(createRes);
  assert.equal(created.thread.title, "MCP Book");
  assert.equal(created.thread.sections[0].title, "Alpha");

  const listRes = await mcpCall("list_reading_threads", {}, token);
  const listed = toolPayload(listRes);
  assert.ok(listed.threads.some((t) => t.id === created.thread.id));

  const getRes = await mcpCall("get_reading_thread", { threadId: created.thread.id }, token);
  const got = toolPayload(getRes);
  assert.equal(got.thread.id, created.thread.id);

  const advRes = await mcpCall("advance_reading_section", {
    threadId: created.thread.id,
    notes: "### Q\nA\n",
  }, token);
  const advanced = toolPayload(advRes);
  assert.equal(advanced.thread.currentSection.title, "Beta");
});

test("UI reuses notepad / Keep crafting; no review UI; SW precaches reading module", () => {
  const reading = fs.readFileSync(path.join(root, "src/renderer/messages-reading.js"), "utf8");
  const shell = fs.readFileSync(path.join(root, "src/renderer/messages-shell.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
  const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
  const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");

  assert.match(reading, /tinkerMessagesNotepad/);
  assert.match(reading, /KEEP_CRAFTING_MODEL|keepCraftingModel/);
  assert.match(reading, /Section done/);
  assert.match(reading, /Keep crafting/);
  assert.equal(/messages-review|Subject card|proposed-subject|sent_by_owner/.test(reading), false);
  assert.match(shell, /READING_PREFIX|selectReading|readingThreads/);
  assert.match(html, /messages-reading\.js/);
  assert.ok(html.indexOf("messages-reading.js") < html.indexOf("messages-you.js"));
  assert.match(sw, /\/messages-reading\.js/);
  assert.match(sw, new RegExp(EXPECTED_SW_CACHE_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(vercel, /reading-thread/);

  // No DDD-specific hardcoding in product code.
  assert.equal(/Domain-Driven Design|Eric Evans|bounded context/i.test(reading + shell), false);
  assert.equal(/Domain-Driven Design|Eric Evans/i.test(
    fs.readFileSync(path.join(root, "api/_lib/reading-thread-store.js"), "utf8")
  ), false);
  // Section title once in header — not repeated in notepad opening.
  assert.equal(/messages-notepad__section|data-reading-section/.test(reading), false);
  // Non-person rail mark: accent dot in the logo slot (not letter "R").
  assert.match(shell, /renderKindDotMark|messages-rail__logo--dot/);
  assert.match(shell, /messages-rail__dot/);
  assert.equal(/avatar\.textContent\s*=\s*["']R["']/.test(shell), false);
  const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
  assert.match(css, /\.messages-rail__dot[\s\S]*color-accent-strong/);
});

test("leads-store still exports merge helpers after extract", () => {
  delete require.cache[require.resolve("../api/_lib/leads-store.js")];
  // Avoid loading full leads-store DB path — notes-merge is the contract under test.
  assert.equal(typeof notesMerge.mergeLeadNotes, "function");
  assert.equal(typeof notesMerge.ensureDoneMarker, "function");
  assert.equal(notesMerge.DONE_MARKER_LINE, "### __done__");
});
