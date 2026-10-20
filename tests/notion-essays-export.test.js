/* Founder Source → Notion Essays one-time export. */
"use strict";

const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-notion-export";
process.env.STYTCH_SECRET = "secret-test-notion-export-key";
process.env.TINKER_SECRETS_KEY = "test-field-secret-notion-export";
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
        const err = new Error("Record to does not exist.");
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
  "notion-essays-export.js",
  "essays-mcp.js",
  "repo-folders-store.js",
  "repo-folders-core.js",
  "db.js",
  "stytch.js",
  "mcp-keys.js",
  "log.js",
]) {
  delete require.cache[path.join(libDir, rel)];
}
delete require.cache[path.join(apiDir, "notion-essays.js")];

stubAt(path.join(libDir, "stytch.js"), {
  authenticateSession: async (token) => {
    if (token !== "user-a") throw Object.assign(new Error("nope"), { status: 401 });
    return { session: { user_id: token } };
  },
});
stubAt(path.join(libDir, "db.js"), database);
stubAt(path.join(libDir, "mcp-keys.js"), {
  isMcpApiKey: (t) => typeof t === "string" && t.startsWith("mcp_"),
  authenticateMcpKey: async () => {
    throw Object.assign(new Error("no"), { status: 401 });
  },
  userIdFromSession: (s) => (s && s.session && s.session.user_id) || "",
});
stubAt(path.join(libDir, "log.js"), {
  withResponseLogging: (fn) => fn,
});

const { encrypt } = require("../api/_lib/secrets-crypto.js");
const store = require("../api/_lib/notion-token-store.js");
const exporter = require("../api/_lib/notion-essays-export.js");
const essaysHandler = require("../api/notion-essays.js");

function fakeRes() {
  const captured = { status: null, body: null, headers: {} };
  return {
    captured,
    setHeader(k, v) { captured.headers[String(k).toLowerCase()] = v; },
    status(c) { captured.status = c; return this; },
    json(p) { captured.body = p; return this; },
    end() {},
  };
}

function seedNotion(parentPageId) {
  rows.push({
    id: "notion_" + (++seq),
    userId: "user-a",
    kind: store.KIND,
    data: {
      accessTokenEnc: encrypt("tok"),
      connectedAt: "2026-10-20T00:00:00.000Z",
      workspaceId: "ws-1",
      parentPageId: parentPageId || "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      essaysDatabaseId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    },
  });
}

function seedEssays(list) {
  rows.push({
    id: "essays_" + (++seq),
    userId: "user-a",
    kind: "essays",
    data: list,
  });
}

beforeEach(() => {
  seq = 0;
  rows.length = 0;
});

test("exerciseTagFor / parseExerciseTag round-trip", () => {
  assert.equal(exporter.exerciseTagFor("e_abc"), "tinker:e_abc");
  assert.equal(exporter.parseExerciseTag("tinker:e_abc"), "e_abc");
  assert.equal(exporter.parseExerciseTag("e_n5iu07ui"), "e_n5iu07ui");
  assert.equal(exporter.parseExerciseTag("Ship the loop"), "");
});

test("export dry-run counts Founder Source only and skips existing titles", async () => {
  seedNotion();
  seedEssays([
    {
      id: "e_one",
      title: "First founder note",
      body: "Body one.",
      contentType: "business",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
    {
      id: "e_two",
      title: "Already in Notion",
      body: "Body two.",
      contentType: "business",
      createdAt: "2026-10-02T00:00:00.000Z",
      updatedAt: "2026-10-02T00:00:00.000Z",
    },
    {
      id: "e_tech",
      title: "Dev essay",
      body: "Should not export.",
      contentType: "technical",
      createdAt: "2026-10-03T00:00:00.000Z",
      updatedAt: "2026-10-03T00:00:00.000Z",
    },
  ]);

  const result = await exporter.exportFounderSourceEssays({
    userId: "user-a",
    dryRun: true,
    writeGapMs: 0,
    fetchImpl: async (url, opts) => {
      if (String(url).includes("/databases/") && String(url).includes("/query")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              {
                object: "page",
                id: "page-existing",
                url: "https://notion.so/existing",
                properties: {
                  Name: {
                    title: [{ plain_text: "Already in Notion" }],
                  },
                  Exercise: { rich_text: [] },
                },
              },
            ],
            has_more: false,
          }),
        };
      }
      throw new Error("unexpected " + url + " " + (opts && opts.method));
    },
  });

  assert.equal(result.found, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.written, 1);
  assert.equal(result.dryRun, true);
  assert.equal(result.writtenPages[0].id, "e_one");
  assert.equal(result.failed, 0);
});

test("export writes missing essays and skips by tinker exercise id", async () => {
  seedNotion();
  seedEssays([
    {
      id: "e_keep",
      title: "Keep me",
      body: "Already tagged.",
      contentType: "business",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
    {
      id: "e_new",
      title: "Brand new",
      body: "Fresh paragraph.",
      contentType: "business",
      createdAt: "2026-10-04T00:00:00.000Z",
      updatedAt: "2026-10-04T12:00:00.000Z",
    },
  ]);

  const pageCreates = [];
  const result = await exporter.exportFounderSourceEssays({
    userId: "user-a",
    dryRun: false,
    writeGapMs: 0,
    fetchImpl: async (url, opts) => {
      const u = String(url);
      if (u.includes("/databases/") && u.includes("/query")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              {
                object: "page",
                id: "page-keep",
                properties: {
                  Name: { title: [{ plain_text: "Other title" }] },
                  Exercise: {
                    rich_text: [{ plain_text: "tinker:e_keep" }],
                  },
                },
              },
            ],
            has_more: false,
          }),
        };
      }
      if (u.endsWith("/pages") && opts.method === "POST") {
        const body = JSON.parse(opts.body);
        pageCreates.push(body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "page-new",
            url: "https://notion.so/page-new",
          }),
        };
      }
      throw new Error("unexpected " + u);
    },
  });

  assert.equal(result.found, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.written, 1);
  assert.equal(result.failed, 0);
  assert.equal(pageCreates.length, 1);
  assert.equal(pageCreates[0].properties.Name.title[0].text.content, "Brand New");
  assert.equal(pageCreates[0].properties.Date.date.start, "2026-10-04");
  assert.match(
    pageCreates[0].properties.Exercise.rich_text[0].text.content,
    /tinker:e_new/,
  );
  assert.ok(pageCreates[0].children.length >= 1);
});

test("export without parent page returns notion_parent_required", async () => {
  rows.push({
    id: "notion_1",
    userId: "user-a",
    kind: store.KIND,
    data: {
      accessTokenEnc: encrypt("tok"),
      connectedAt: "2026-10-20T00:00:00.000Z",
    },
  });
  seedEssays([
    {
      id: "e_x",
      title: "X",
      body: "Body",
      contentType: "business",
      createdAt: "2026-10-01T00:00:00.000Z",
    },
  ]);
  await assert.rejects(
    () =>
      exporter.exportFounderSourceEssays({
        userId: "user-a",
        dryRun: true,
        writeGapMs: 0,
        fetchImpl: async () => {
          throw new Error("should not call Notion");
        },
      }),
    (err) => err && err.code === "notion_parent_required",
  );
});

test("POST export-founder-source action returns counts", async () => {
  seedNotion();
  seedEssays([
    {
      id: "e_api",
      title: "Via API",
      body: "Hello export.",
      contentType: "business",
      createdAt: "2026-10-05T00:00:00.000Z",
      updatedAt: "2026-10-05T00:00:00.000Z",
    },
  ]);

  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/databases/") && String(url).includes("/query")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [], has_more: false }),
      };
    }
    if (String(url).endsWith("/pages")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "np", url: "https://notion.so/np" }),
      };
    }
    throw new Error("unexpected " + url);
  };
  try {
    const res = fakeRes();
    await essaysHandler(
      {
        method: "POST",
        url: "/api/notion-essays?action=export-founder-source",
        headers: { authorization: "Bearer user-a" },
        body: { dryRun: true },
      },
      res,
    );
    assert.equal(res.captured.status, 200);
    assert.equal(res.captured.body.ok, true);
    assert.equal(res.captured.body.export.found, 1);
    assert.equal(res.captured.body.export.written, 1);
    assert.equal(res.captured.body.export.dryRun, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("export script documents dry-run and direct flags", () => {
  const fs = require("fs");
  const src = fs.readFileSync(
    path.join(__dirname, "..", "scripts/export-founder-source-to-notion.js"),
    "utf8",
  );
  assert.match(src, /export-founder-source/);
  assert.match(src, /--dry-run/);
  assert.match(src, /--direct/);
  assert.match(src, /--owner-lindow-labs/);
  assert.match(src, /TINKER_SESSION_TOKEN/);
});
