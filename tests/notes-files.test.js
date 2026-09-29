/* TYL-49: local note files — serialize/parse, memory backend, wiring. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.resolve(__dirname, "..", "src", "renderer");
const read = (p) => fs.readFileSync(path.join(SRC_DIR, p), "utf8");

const notesFiles = require(path.join(SRC_DIR, "notes-files.js"));
const NOTES_JS = read("notes.js");
const NOTES_CSS = read("notes.css");
const INDEX_HTML = read("index.html");
const SW = read("sw.js");

test("serializeNote writes frontmatter and body as one Markdown file", () => {
  const text = notesFiles.serializeNote({
    id: "n_testnote01",
    title: "Hello",
    body: "Line one\n\nLine two",
    createdAt: 1000,
    updatedAt: 2000,
    syncState: "local",
  });
  assert.match(text, /^---\n/);
  assert.match(text, /\nid: n_testnote01\n/);
  assert.match(text, /\ntitle: Hello\n/);
  assert.match(text, /\ncreatedAt: 1000\n/);
  assert.match(text, /\nupdatedAt: 2000\n/);
  assert.match(text, /\nsyncState: local\n/);
  assert.match(text, /\n---\n\nLine one\n\nLine two$/);
});

test("parseNoteFile round-trips and titles from the first body line", () => {
  const text = notesFiles.serializeNote({
    id: "n_roundtrip01",
    title: "",
    body: "First line wins\nMore text",
    createdAt: 10,
    updatedAt: 20,
  });
  const note = notesFiles.parseNoteFile(text);
  assert.equal(note.id, "n_roundtrip01");
  assert.equal(note.title, "First line wins");
  assert.equal(note.body, "First line wins\nMore text");
  assert.equal(note.createdAt, 10);
  assert.equal(note.updatedAt, 20);
  assert.equal(note.syncState, "local");
});

test("memory backend create/list/get/save/remove keeps one file per note", async () => {
  const backend = notesFiles.createMemoryBackend();
  const store = notesFiles.createStore(Promise.resolve(backend));

  const created = await store.create({ body: "Groceries\nMilk" });
  assert.match(created.id, /^n_/);
  assert.equal(created.title, "Groceries");
  assert.equal(created.syncState, "local");

  const listed = await store.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, created.id);
  assert.equal(listed[0].title, "Groceries");

  const dumped = backend._dump();
  assert.ok(Object.prototype.hasOwnProperty.call(dumped, created.id));
  assert.match(dumped[created.id], /^---\n/);

  const saved = await store.save({
    id: created.id,
    body: "Groceries\nMilk\nEggs",
  });
  assert.equal(saved.body, "Groceries\nMilk\nEggs");
  assert.ok(saved.updatedAt >= created.updatedAt);

  const again = await store.get(created.id);
  assert.equal(again.body, "Groceries\nMilk\nEggs");

  await store.remove(created.id);
  assert.equal(await store.get(created.id), null);
  assert.deepEqual(await store.list(), []);
});

test("notes UI is wired into the shell and stays local-only", () => {
  assert.match(INDEX_HTML, /id="nav-notes"/, "sidebar has a Notes entry");
  assert.match(INDEX_HTML, /href="\.\/notes\.css"/, "notes stylesheet is linked");
  assert.match(INDEX_HTML, /src="\.\/notes-files\.js"/, "notes-files loads");
  assert.match(INDEX_HTML, /src="\.\/notes\.js"/, "notes UI loads");
  assert.match(
    NOTES_JS,
    /window\.tinkerNotes\s*=\s*\{[\s\S]*?open[\s\S]*?close/,
    "exposes window.tinkerNotes",
  );
  assert.match(NOTES_JS, /notes-textarea/, "full-screen typing textarea");
  assert.match(NOTES_JS, /Saved on this device/, "local save copy");
  assert.doesNotMatch(
    NOTES_JS,
    /fetch\s*\(/,
    "notes UI must not call the network",
  );
  assert.match(NOTES_CSS, /\.notes-textarea/, "editor styles exist");
  assert.match(SW, /tinker-shell-v11/, "service worker cache bumped for notes assets");
  assert.match(SW, /\/notes-files\.js/, "notes-files is precached");
  assert.match(SW, /\/notes\.js/, "notes UI is precached");
  assert.match(SW, /\/notes\.css/, "notes CSS is precached");
  assert.match(
    read("styles.css"),
    /aria-label="Notes"/,
    "stage stacking rules cover the Notes overlay",
  );
});

test("notes-files prefers OPFS files under notes/ with localStorage fallback", () => {
  const src = read("notes-files.js");
  assert.match(src, /getDirectory/, "uses Origin Private File System");
  assert.match(src, /"notes"/, "stores under a notes directory");
  assert.match(src, /tinker\.notes\.files\.v1/, "localStorage fallback key");
  assert.match(src, /\.md/, "writes Markdown note files");
});
