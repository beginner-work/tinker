/* TYL-49 content store: per-user isolation, published-only public reads,
 * and idempotent drafts. Postgres is stubbed. No model calls.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

process.env.STYTCH_PROJECT_ID = "project-test-content";
process.env.STYTCH_SECRET = "secret-test-not-real";

const rows = [];
let seq = 0;

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

function uniqueErr() {
  return Object.assign(new Error("unique constraint"), { code: "P2002" });
}

stubAt(path.join(libDir, "db.js"), {
  $executeRawUnsafe: async () => 0,
  contentItem: {
    create: async ({ data }) => {
      if (rows.some((row) => row.site === data.site && row.slug === data.slug)) throw uniqueErr();
      if (data.draftKey && rows.some((row) => row.userId === data.userId && row.draftKey === data.draftKey)) {
        throw uniqueErr();
      }
      const now = new Date(Date.UTC(2026, 8, 28, 12, 0, seq));
      const row = Object.assign({
        id: "ci_" + (++seq),
        body: "",
        fields: {},
        noteId: null,
        draftKey: null,
        createdAt: now,
        updatedAt: now,
      }, data);
      rows.push(row);
      return row;
    },
    findUnique: async ({ where }) => {
      if (where.id) return rows.find((row) => row.id === where.id) || null;
      if (where.site_slug) {
        return rows.find((row) => row.site === where.site_slug.site && row.slug === where.site_slug.slug) || null;
      }
      if (where.userId_draftKey) {
        const key = where.userId_draftKey;
        return rows.find((row) => row.userId === key.userId && row.draftKey === key.draftKey) || null;
      }
      return null;
    },
    findMany: async ({ where = {} } = {}) => {
      return rows.filter((row) => {
        return Object.entries(where).every(([key, value]) => row[key] === value);
      }).slice().sort((a, b) => {
        const diff = new Date(b.updatedAt) - new Date(a.updatedAt);
        if (diff) return diff;
        return String(a.slug).localeCompare(String(b.slug));
      });
    },
    update: async ({ where, data }) => {
      if (!where || Object.keys(where).length !== 1 || !where.id) {
        throw new Error("update must be one row id");
      }
      const row = rows.find((item) => item.id === where.id);
      if (!row) throw Object.assign(new Error("not found"), { code: "P2025" });
      Object.assign(row, data, { updatedAt: new Date(Date.UTC(2026, 8, 28, 18, 0, seq)) });
      return row;
    },
  },
});

const store = require("../api/_lib/content-store.js");
const owner = require("../api/content.js");
const pub = require("../api/content-public.js");
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
    url: url || "/api/content",
    headers: { authorization: token ? "Bearer " + token : "" },
    body,
    query: query || {},
  };
}

function publicReq({ site, slug, type, method = "GET" }) {
  const params = new URLSearchParams();
  if (site) params.set("site", site);
  if (slug) params.set("slug", slug);
  if (type) params.set("type", type);
  return {
    method,
    url: "/api/content-public?" + params.toString(),
    headers: {},
    query: { site, slug, type },
  };
}

function mcpReq(token, name, args) {
  return {
    method: "POST",
    url: "/api/mcp",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args || {} },
    },
  };
}

test.beforeEach(() => {
  rows.length = 0;
  seq = 0;
  store.resetTableCache();
});

test("migration SQL matches the statements the server applies", () => {
  const file = fs.readFileSync(
    path.join(__dirname, "..", "prisma", "migrations", "20260928220000_add_content_items", "migration.sql"),
    "utf8",
  );
  for (const statement of store.TABLE_STATEMENTS) {
    assert.ok(file.includes(statement), statement.slice(0, 60));
  }
  const src = fs.readFileSync(path.join(libDir, "content-store.js"), "utf8");
  assert.equal(src.includes("api.anthropic.com"), false);
  assert.equal(src.includes("ANTHROPIC"), false);
  assert.equal(src.includes("@vercel/blob"), false);
});

test("Marisol seed items are the PR #38 content shape and use unique slugs", () => {
  const items = store.marisolSeedItems();
  const slugs = items.map((item) => item.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(items.every((item) => item.site === "dreamingwithmarisol.com"), true);
  assert.equal(items.filter((item) => item.type === "page_section" && item.slug === "about").length, 1);
  assert.equal(items.filter((item) => item.type === "product").length, 2);
  assert.equal(items.filter((item) => item.type === "event").length, 2);
  assert.equal(items.filter((item) => item.type === "post").length, 15);
  assert.ok(items.find((item) => item.slug === "about").fields.heroTitle);
  assert.equal(items.every((item) => store.TYPES.includes(item.type)), true);
  const about = items.find((item) => item.slug === "about");
  assert.match(about.body, /Curanderismo/);
});

test("another user's item is 404 and is absent from the owner's list", async () => {
  const created = fakeRes();
  await owner(apiReq({
    method: "POST",
    body: {
      site: "lindowlabs.dev",
      type: "post",
      slug: "you-are-the-product",
      title: "You are the product!",
      body: "Notes become the site.",
      noteId: "note-secret",
      status: "published",
    },
  }), created);
  assert.equal(created.captured.status, 201);
  assert.equal(created.captured.body.item.status, "published");
  assert.equal(created.captured.body.item.noteId, "note-secret");
  assert.equal(created.captured.body.item.userId, undefined);
  assert.equal(created.captured.headers["cache-control"], "no-store");
  const id = created.captured.body.item.id;

  const other = fakeRes();
  await owner(apiReq({ method: "GET", token: "user-b", query: { id } }), other);
  assert.equal(other.captured.status, 404);
  assert.equal(JSON.stringify(other.captured.body).includes("You are the product!"), false);
  assert.equal(JSON.stringify(other.captured.body).includes("note-secret"), false);

  const otherList = fakeRes();
  await owner(apiReq({ method: "GET", token: "user-b" }), otherList);
  assert.equal(otherList.captured.status, 200);
  assert.deepEqual(otherList.captured.body.items, []);

  const stolen = fakeRes();
  await owner(apiReq({
    method: "PATCH",
    token: "user-b",
    body: { id, title: "Stolen" },
  }), stolen);
  assert.equal(stolen.captured.status, 404);
  assert.equal(rows[0].title, "You are the product!");

  const collide = fakeRes();
  await owner(apiReq({
    method: "POST",
    token: "user-b",
    body: {
      site: "lindowlabs.dev",
      type: "post",
      slug: "you-are-the-product",
      title: "Mine",
    },
  }), collide);
  assert.equal(collide.captured.status, 404);
  assert.equal(rows.length, 1);
});

test("the public API returns published items only and is cacheable", async () => {
  await owner(apiReq({
    method: "POST",
    body: {
      site: "https://dreamingwithmarisol.com/about",
      type: "page_section",
      slug: "about",
      title: "Marisól",
      body: "public body",
      status: "published",
      fields: { heroTitle: "Marisól" },
    },
  }), fakeRes());
  await owner(apiReq({
    method: "POST",
    body: {
      site: "dreamingwithmarisol.com",
      type: "post",
      slug: "private-note",
      title: "Still a draft",
      body: "draft-only-secret",
      noteId: "note-secret",
    },
  }), fakeRes());

  const list = fakeRes();
  await pub(publicReq({ site: "dreamingwithmarisol.com" }), list);
  assert.equal(list.captured.status, 200);
  assert.equal(list.captured.headers["cache-control"], "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
  assert.equal(list.captured.body.site, "dreamingwithmarisol.com");
  assert.equal(list.captured.body.items.length, 1);
  assert.equal(list.captured.body.items[0].slug, "about");
  assert.equal(list.captured.body.items[0].status, "published");
  const encoded = JSON.stringify(list.captured.body);
  assert.equal(encoded.includes("draft-only-secret"), false);
  assert.equal(encoded.includes("note-secret"), false);
  assert.equal(encoded.includes("user-a"), false);
  assert.equal(encoded.includes("draftKey"), false);

  const draftSlug = fakeRes();
  await pub(publicReq({ site: "dreamingwithmarisol.com", slug: "private-note" }), draftSlug);
  assert.equal(draftSlug.captured.status, 404);
  assert.equal(draftSlug.captured.headers["cache-control"], "public, max-age=15");
  assert.equal(JSON.stringify(draftSlug.captured.body).includes("draft-only-secret"), false);

  const one = fakeRes();
  await pub(publicReq({ site: "dreamingwithmarisol.com", slug: "about" }), one);
  assert.equal(one.captured.status, 200);
  assert.equal(one.captured.body.item.body, "public body");
  assert.equal(one.captured.body.item.fields.heroTitle, "Marisól");
});

test("drafts are idempotent and bots cannot publish", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error("content tools must not call the network");
  };
  try {
    const first = fakeRes();
    await mcp(mcpReq("user-a", "create_content_draft", {
      site: "lindowlabs.dev",
      type: "post",
      slug: "portal",
      title: "Original title",
      body: "Original body",
      draftKey: "draft-portal",
      noteId: "note-1",
      userId: "user-b",
    }), first);
    assert.equal(first.captured.status, 200);
    assert.equal(first.captured.body.result.isError, undefined);
    assert.equal(first.captured.body.result.structuredContent.created, true);
    assert.equal(first.captured.body.result.structuredContent.item.status, "draft");
    assert.equal(first.captured.body.result.structuredContent.item.userId, undefined);
    const id = first.captured.body.result.structuredContent.item.id;

    const again = fakeRes();
    await mcp(mcpReq("user-a", "create_content_draft", {
      site: "lindowlabs.dev",
      type: "post",
      slug: "portal",
      title: "Changed title",
      body: "Changed body",
      draftKey: "draft-portal",
    }), again);
    assert.equal(again.captured.body.result.structuredContent.created, false);
    assert.equal(again.captured.body.result.structuredContent.item.id, id);
    assert.equal(again.captured.body.result.structuredContent.item.title, "Original title");
    assert.equal(again.captured.body.result.structuredContent.item.body, "Original body");
    assert.equal(rows.length, 1);

    const publish = fakeRes();
    await mcp(mcpReq("user-a", "create_content_draft", {
      site: "lindowlabs.dev",
      type: "post",
      slug: "portal-live",
      title: "Do not publish",
      status: "published",
    }), publish);
    assert.equal(publish.captured.body.result.isError, true);
    assert.match(publish.captured.body.result.content[0].text, /Bots cannot publish/);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "draft");

    const otherRead = fakeRes();
    await mcp(mcpReq("user-b", "read_content", { id }), otherRead);
    assert.equal(otherRead.captured.body.result.isError, true);
    assert.match(otherRead.captured.body.result.content[0].text, /No content item with that id/);
    assert.equal(JSON.stringify(otherRead.captured.body).includes("Original body"), false);

    const otherList = fakeRes();
    await mcp(mcpReq("user-b", "list_content", { userId: "user-a", site: "lindowlabs.dev" }), otherList);
    assert.deepEqual(otherList.captured.body.result.structuredContent.items, []);

    const ownList = fakeRes();
    await mcp(mcpReq("user-a", "list_content", { site: "lindowlabs.dev" }), ownList);
    assert.equal(ownList.captured.body.result.structuredContent.items.length, 1);
    assert.equal(ownList.captured.body.result.structuredContent.items[0].id, id);
  } finally {
    global.fetch = originalFetch;
  }
});

test("connector credentials are rejected on the owner routes", async () => {
  const res = fakeRes();
  await owner(apiReq({
    method: "POST",
    token: "mcp_not-a-session",
    body: { site: "lindowlabs.dev", type: "post", slug: "x", title: "X" },
  }), res);
  assert.equal(res.captured.status, 401);
  assert.match(res.captured.body.error, /Connector credentials cannot change content/);
  assert.equal(rows.length, 0);
});

test("importing the Marisol seed twice does not duplicate or publish", async () => {
  const first = fakeRes();
  await owner(apiReq({ method: "POST", body: { action: "import" } }), first);
  assert.equal(first.captured.status, 200);
  assert.equal(first.captured.body.site, "dreamingwithmarisol.com");
  assert.equal(first.captured.body.created, store.marisolSeedItems().length);
  assert.equal(first.captured.body.items.every((item) => item.status === "draft"), true);
  const ids = first.captured.body.items.map((item) => item.id);

  const second = fakeRes();
  await owner(apiReq({
    method: "POST",
    body: { action: "import", publish: true, site: "https://dreamingwithmarisol.com/" },
  }), second);
  assert.equal(second.captured.body.created, 0);
  assert.deepEqual(second.captured.body.items.map((item) => item.id), ids);
  assert.equal(second.captured.body.items.every((item) => item.status === "draft"), true);

  const listed = fakeRes();
  await pub(publicReq({ site: "dreamingwithmarisol.com" }), listed);
  assert.deepEqual(listed.captured.body.items, []);

  const published = fakeRes();
  await owner(apiReq({
    method: "POST",
    body: { action: "publish", id: ids[0] },
  }), published);
  assert.equal(published.captured.status, 200);
  assert.equal(published.captured.body.item.status, "published");

  const live = fakeRes();
  await pub(publicReq({ site: "dreamingwithmarisol.com" }), live);
  assert.equal(live.captured.body.items.length, 1);
  assert.equal(live.captured.body.items[0].id, ids[0]);

  const wrongSite = fakeRes();
  await owner(apiReq({
    method: "POST",
    body: { action: "import", site: "lindowlabs.dev" },
  }), wrongSite);
  assert.equal(wrongSite.captured.status, 400);
});
