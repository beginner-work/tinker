/* /repo folders: create, nest, move, rename, delete guard, content types. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const fs = require("node:fs");

process.env.STYTCH_PROJECT_ID = "project-test-repo-folders";
process.env.STYTCH_SECRET = "secret-test-not-real";

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
      const now = new Date(Date.UTC(2026, 9, 3, 12, 0, ++seq));
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
  "repo-folders-store.js",
  "repo-folders-core.js",
  "self-reflections.js",
  "self-thread-store.js",
  "db.js",
  "stytch.js",
  "mcp-keys.js",
]) {
  delete require.cache[path.join(libDir, rel)];
}
delete require.cache[path.join(apiDir, "repo-folders.js")];
delete require.cache[path.join(apiDir, "self-reflections.js")];

stubAt(path.join(libDir, "stytch.js"), {
  authenticateSession: async (token) => {
    if (token !== "user-a" && token !== "user-b") {
      throw Object.assign(new Error("nope"), { status: 401 });
    }
    return {
      session: { user_id: token },
      user: { user_id: token, emails: [{ email: token + "@example.com" }] },
    };
  },
});
stubAt(path.join(libDir, "mcp-keys.js"), {
  userIdFromSession: (session) =>
    (session && session.session && session.session.user_id) ||
    (session && session.user && session.user.user_id) ||
    "",
});
stubAt(path.join(libDir, "db.js"), database);
stubAt(path.join(libDir, "log.js"), {
  withResponseLogging: (fn) => fn,
});

const store = require("../api/_lib/repo-folders-store.js");
const core = require("../api/_lib/repo-folders-core.js");
const handler = require("../api/repo-folders.js");
const reflections = require("../api/_lib/self-reflections.js");

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function call(method, action, token, body) {
  const req = {
    method,
    url: "/api/repo-folders?action=" + encodeURIComponent(action || ""),
    query: { action: action || "" },
    headers: { authorization: token ? "Bearer " + token : "" },
    body: body || {},
  };
  const res = mockRes();
  await handler(req, res);
  return res;
}

test("content types list and default", () => {
  assert.deepEqual(core.CONTENT_TYPES, [
    "reflections", "stories", "exercises", "readings", "drafts",
  ]);
  assert.equal(core.DEFAULT_CONTENT_TYPE, "stories");
  assert.equal(core.normalizeContentType("drafts"), "drafts");
  assert.equal(core.normalizeContentType("nope"), "stories");
});

test("create folder, nest, rename, move file, type inheritance", async () => {
  tables.tinkerUserData.rows.length = 0;
  const root = await store.createFolder({
    userId: "user-a",
    name: "Career stories",
    contentType: "stories",
  });
  assert.equal(root.folder.contentType, "stories");
  assert.equal(root.tree.folders.length, 1);

  const nested = await store.createFolder({
    userId: "user-a",
    name: "Incidents",
    parentId: root.folder.id,
  });
  assert.equal(nested.folder.parentId, root.folder.id);
  assert.equal(nested.folder.contentType, "stories", "nested inherits parent type");

  await assert.rejects(
    () => store.createFolder({
      userId: "user-a",
      name: "Wrong type",
      parentId: root.folder.id,
      contentType: "drafts",
    }),
    (err) => err.status === 400 && err.code === "nested_type_locked"
  );

  const renamed = await store.renameFolder({
    userId: "user-a",
    folderId: nested.folder.id,
    name: "On-call",
  });
  assert.equal(renamed.folder.name, "On-call");

  const moved = await store.moveFile({
    userId: "user-a",
    fileId: "self_1",
    folderId: nested.folder.id,
  });
  assert.equal(moved.folderId, nested.folder.id);
  assert.equal(moved.contentType, "stories");
  assert.equal(moved.tree.placements.self_1, nested.folder.id);

  const tree = await store.getTree({ userId: "user-a" });
  assert.equal(core.effectiveContentType(tree.folders, tree.placements, "self_1"), "stories");
  assert.equal(core.effectiveContentType(tree.folders, tree.placements, "orphan"), "stories");
  assert.match(
    core.fileRelPath(tree.folders, nested.folder.id, "2026-10-03-note.md"),
    /^stories\/Career stories\/On-call\/2026-10-03-note\.md$/
  );
});

test("duplicate names rejected; empty name rejected", async () => {
  tables.tinkerUserData.rows.length = 0;
  await store.createFolder({ userId: "user-a", name: "Drafts", contentType: "drafts" });
  await assert.rejects(
    () => store.createFolder({ userId: "user-a", name: "drafts", contentType: "drafts" }),
    (err) => err.status === 409 && err.code === "duplicate_name"
  );
  await assert.rejects(
    () => store.createFolder({ userId: "user-a", name: "   " }),
    (err) => err.status === 400
  );
});

test("non-empty delete requires confirm; keep moves files to parent", async () => {
  tables.tinkerUserData.rows.length = 0;
  const parent = await store.createFolder({
    userId: "user-a",
    name: "Parent",
    contentType: "reflections",
  });
  const child = await store.createFolder({
    userId: "user-a",
    name: "Child",
    parentId: parent.folder.id,
  });
  await store.moveFile({ userId: "user-a", fileId: "file_a", folderId: child.folder.id });

  await assert.rejects(
    () => store.deleteFolder({ userId: "user-a", folderId: child.folder.id }),
    (err) => err.status === 409 && err.code === "folder_not_empty"
  );

  const kept = await store.deleteFolder({
    userId: "user-a",
    folderId: child.folder.id,
    confirm: true,
    deleteContents: false,
  });
  assert.equal(kept.writingPreserved, true);
  assert.equal(kept.tree.placements.file_a, parent.folder.id);
  assert.equal(kept.tree.folders.some((f) => f.id === child.folder.id), false);
  assert.equal(kept.tree.folders.some((f) => f.id === parent.folder.id), true);
});

test("deleteContents removes nested folders but preserves writing at parent", async () => {
  tables.tinkerUserData.rows.length = 0;
  const parent = await store.createFolder({
    userId: "user-a",
    name: "Root",
    contentType: "exercises",
  });
  const mid = await store.createFolder({
    userId: "user-a",
    name: "Mid",
    parentId: parent.folder.id,
  });
  const leaf = await store.createFolder({
    userId: "user-a",
    name: "Leaf",
    parentId: mid.folder.id,
  });
  await store.moveFile({ userId: "user-a", fileId: "keep_me", folderId: leaf.folder.id });

  const result = await store.deleteFolder({
    userId: "user-a",
    folderId: mid.folder.id,
    confirm: true,
    deleteContents: true,
  });
  assert.equal(result.writingPreserved, true);
  assert.equal(result.tree.placements.keep_me, parent.folder.id);
  assert.equal(result.tree.folders.some((f) => f.id === mid.folder.id), false);
  assert.equal(result.tree.folders.some((f) => f.id === leaf.folder.id), false);
  assert.equal(
    core.effectiveContentType(result.tree.folders, result.tree.placements, "keep_me"),
    "exercises"
  );
});

test("HTTP list/create and auth", async () => {
  tables.tinkerUserData.rows.length = 0;
  const denied = await call("GET", "list", "", null);
  assert.equal(denied.statusCode, 401);

  const created = await call("POST", "create_folder", "user-a", {
    name: "Readings",
    contentType: "readings",
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.body.folder.contentType, "readings");

  const listed = await call("GET", "list", "user-a", null);
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.body.folders.length, 1);
  assert.ok(listed.body.contentTypes.includes("readings"));
});

test("HTTP set_place stores and clears a writing place per file", async () => {
  tables.tinkerUserData.rows.length = 0;
  const set = await call("POST", "set_place", "user-a", {
    fileId: "self_1",
    place: "San Diego",
  });
  assert.equal(set.statusCode, 200);
  assert.equal(set.body.place, "San Diego");
  assert.equal(set.body.tree.places.self_1, "San Diego");

  const listed = await call("GET", "list", "user-a", null);
  assert.equal(listed.body.places.self_1, "San Diego");

  const cleared = await call("POST", "set_place", "user-a", {
    fileId: "self_1",
    place: "",
  });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.body.place, null);
  assert.equal(cleared.body.tree.places.self_1, undefined);
});

test("self-reflections attach effective contentType from placements", async () => {
  tables.tinkerUserData.rows.length = 0;
  // Seed a self_thread message via blob the reflections reader understands.
  tables.tinkerUserData.rows.push({
    userId: "user-a",
    kind: "self_thread",
    data: {
      messages: [{
        id: "self_story_1",
        title: "A story",
        body: "body text",
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      }],
    },
    updatedAt: new Date(),
  });
  const folder = await store.createFolder({
    userId: "user-a",
    name: "Private",
    contentType: "reflections",
  });
  await store.moveFile({
    userId: "user-a",
    fileId: "self_story_1",
    folderId: folder.folder.id,
  });

  const rows = await reflections.listSelfReflections({ userId: "user-a", limit: 20 });
  const hit = rows.find((r) => r.id === "self_story_1");
  assert.ok(hit);
  assert.equal(hit.folderId, folder.folder.id);
  assert.equal(hit.contentType, "reflections");
});

test("repo page wires New folder, Move to sheet, and cache-busted assets", () => {
  const writeHtml = fs.readFileSync(path.join(__dirname, "../src/renderer/repo/index.html"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../src/renderer/repo/files/index.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../src/renderer/repo/repo.css"), "utf8");
  const page = fs.readFileSync(path.join(__dirname, "../src/renderer/repo/repo.js"), "utf8");
  const vercel = fs.readFileSync(path.join(__dirname, "../vercel.json"), "utf8");
  assert.match(html, /id="repo-new-folder"/);
  assert.match(html, />New folder</);
  assert.match(html, /id="repo-move-sheet"/);
  assert.match(html, /Move to/);
  assert.match(html, /repo-folders-core\.js\?v=35/);
  assert.match(html, /repo\.js\?v=35/);
  assert.match(html, /repo\.css\?v=35/);
  assert.match(writeHtml, /storage-section\.js\?v=40/);
  assert.match(writeHtml, /repo\.css\?v=42/);
  assert.match(writeHtml, /repo\.js\?v=42/);
  assert.doesNotMatch(writeHtml, /id="repo-files-link"/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /\.repo-sheet/);
  assert.match(css, /minmax\(280px,\s*340px\)/);
  assert.match(css, /\.repo-tree__more-pop/);
  assert.match(css, /\.repo-tree__more-item/);
  assert.match(page, /create_folder|move_file|delete_folder|set_place/);
  assert.match(page, /contentType|CONTENT_TYPES/);
  assert.match(page, /More folder actions/);
  assert.match(page, /aria-haspopup["']\s*,\s*["']menu["']/);
  assert.match(page, /openMenuFolderId/);
  assert.match(page, /repo-tree__more-item/);
  assert.match(page, /startRenameFolder/);
  assert.match(page, /requestDeleteFolder/);
  assert.match(vercel, /repo-folders/);
  assert.match(vercel, /\/repo\/files/);
  assert.equal(page.includes("innerHTML"), false);
  // One More button per folder row. Rename/Delete are menuitems, not row icon buttons.
  assert.equal((page.match(/repo-tree__more-btn/g) || []).length >= 1, true);
  assert.equal(page.includes('renameBtn.className = "repo-tree__icon-btn"'), false);
  assert.equal(page.includes('deleteBtn.className = "repo-tree__icon-btn"'), false);
});
