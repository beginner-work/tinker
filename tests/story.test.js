/* Unit tests for src/renderer/story.js — the one verbatim story.
 *
 * The story is every published writing, oldest first, exactly as
 * written; locking it in snapshots it with the founder's ask and
 * publishes the whole thing to their public profile via
 * /api/publish/booklet. These tests drive the data API in the same
 * thin VM shim the renderer tests use; the DOM mounts are absent, so
 * render paths no-op and the model logic is what's exercised.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const STORY_SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "renderer", "story.js"),
  "utf8",
);

function loadInSandbox({ essays = [], drafts = [], seedStory = null, fetchImpl = null, token = "tok_test" } = {}) {
  const store = new Map();
  if (essays.length) store.set("tinker.essays.v1", JSON.stringify(essays));
  if (drafts.length) store.set("tinker.drafts.v1", JSON.stringify(drafts));
  if (seedStory) store.set("tinker.story.v1", JSON.stringify(seedStory));
  if (token) store.set("tinker_jwt", token);

  const localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  };
  const document = {
    readyState: "complete",
    addEventListener() {},
    querySelector() { return null; },
    getElementById() { return null; },
  };
  const win = {
    document,
    localStorage,
    addEventListener() {},
    dispatchEvent() {},
  };
  win.window = win;

  const sandbox = {
    window: win,
    document,
    localStorage,
    console,
    setTimeout,
    clearTimeout,
    fetch: fetchImpl || (() => Promise.reject(new Error("network disabled in tests"))),
    CustomEvent: function CustomEvent(name, init) { this.type = name; this.detail = init && init.detail; },
  };
  vm.createContext(sandbox);
  vm.runInContext(STORY_SRC, sandbox);
  return { story: win.tinkerStory, store };
}

function essay(id, body, createdAt, extra) {
  return Object.assign(
    { id, kind: "essay", title: "Title of " + id, body, author: "you", createdAt },
    extra || {},
  );
}

test("storyEssays returns every non-archived writing, oldest first, verbatim", () => {
  const { story } = loadInSandbox({
    essays: [
      essay("e_new", "the newest words, exactly as typed", 3000),
      essay("e_old", "the OLDEST words —\n\nwith their line breaks", 1000),
      essay("e_mid", "the middle words", 2000),
      essay("e_archived", "put away on purpose", 1500, { archived: true }),
      essay("e_blank", "   ", 1200),
    ],
  });
  const order = story.storyEssays();
  assert.deepEqual(Array.from(order.map((e) => e.id)), ["e_old", "e_mid", "e_new"]);
  assert.equal(
    order[0].body,
    "the OLDEST words —\n\nwith their line breaks",
    "bodies pass through verbatim — punctuation, breaks and all",
  );
});

test("statuses (no title) belong to the story too", () => {
  const { story } = loadInSandbox({
    essays: [
      { id: "e_status", kind: "status", title: null, body: "a quick thought", createdAt: 50 },
      essay("e_essay", "a longer essay body", 100),
    ],
  });
  const order = story.storyEssays();
  assert.deepEqual(Array.from(order.map((e) => e.id)), ["e_status", "e_essay"]);
  assert.equal(order[0].kind, "status");
  assert.equal(order[0].title, "");
});

test("wordCount sums the story's words", () => {
  const { story } = loadInSandbox({
    essays: [essay("e_1", "one two three", 1), essay("e_2", "four  five", 2)],
  });
  assert.equal(story.wordCount(), 5);
});

test("draftsInProgress lists drafts newest first with their working titles", () => {
  const { story } = loadInSandbox({
    drafts: [
      { id: "d_old", title: "Older draft", updatedAt: 100, transcript: [] },
      { id: "d_new", title: "Newer draft", updatedAt: 200, transcript: [] },
    ],
  });
  assert.deepEqual(Array.from(story.draftsInProgress().map((d) => d.id)), ["d_new", "d_old"]);
  assert.equal(story.draftsInProgress()[0].title, "Newer draft");
});

test("lockIn snapshots the story, keeps the ask verbatim, and publishes the booklet", async () => {
  let sentUrl = null;
  let sentBody = null;
  const fetchImpl = (url, opts) => {
    sentUrl = url;
    sentBody = JSON.parse(opts.body);
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, storiesUrl: "https://beginner.work/you#stories" }),
    });
  };
  const { story, store } = loadInSandbox({
    essays: [essay("e_1", "first words", 1), essay("e_2", "second words", 2)],
    fetchImpl,
  });

  const result = await story.lockIn("  $300k  ");
  assert.equal(result.ok, true);
  assert.equal(sentUrl, "/api/publish/booklet");
  assert.equal(sentBody.pitches.length, 1);
  assert.equal(sentBody.pitches[0].slug, "story");
  assert.deepEqual(
    Array.from(sentBody.pitches[0].stories.map((s) => s.body)),
    ["first words", "second words"],
    "the booklet carries every piece, verbatim, in story order",
  );

  const lock = story.getLock();
  assert.equal(lock.ask, "$300k", "the ask is kept as typed (trimmed)");
  assert.ok(lock.lockedAt > 0);
  assert.deepEqual(Array.from(lock.lockedEssayIds), ["e_1", "e_2"]);
  assert.equal(lock.storiesUrl, "https://beginner.work/you#stories");

  // Persisted for the sync layer to pick up.
  const saved = JSON.parse(store.get("tinker.story.v1"));
  assert.equal(saved.ask, "$300k");
});

test("lockIn refuses an empty ask, an empty story, and a signed-out session", async () => {
  const ok = { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
  const { story } = loadInSandbox({
    essays: [essay("e_1", "words", 1)],
    fetchImpl: () => Promise.resolve(ok),
  });
  const noAsk = await story.lockIn("   ");
  assert.equal(noAsk.ok, false);
  assert.match(noAsk.error, /number/i);

  const empty = loadInSandbox({ essays: [], fetchImpl: () => Promise.resolve(ok) });
  const noStory = await empty.story.lockIn("$10");
  assert.equal(noStory.ok, false);

  const signedOut = loadInSandbox({
    essays: [essay("e_1", "words", 1)],
    fetchImpl: () => Promise.resolve(ok),
    token: null,
  });
  const noToken = await signedOut.story.lockIn("$10");
  assert.equal(noToken.ok, false);
  assert.match(noToken.error, /sign in/i);
});

test("a failed publish leaves the lock unset", async () => {
  const { story } = loadInSandbox({
    essays: [essay("e_1", "words", 1)],
    fetchImpl: () => Promise.resolve({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ ok: false, error: "boom" }),
    }),
  });
  const result = await story.lockIn("$10");
  assert.equal(result.ok, false);
  assert.equal(story.getLock().lockedAt, null, "no lock is recorded on failure");
});

test("grownSinceLock reports the pieces written after the lock", async () => {
  const fetchImpl = () => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ ok: true }),
  });
  const { story, store } = loadInSandbox({
    essays: [essay("e_1", "first", 1)],
    fetchImpl,
  });
  assert.deepEqual(Array.from(story.grownSinceLock()), [], "never locked → nothing has 'grown'");

  await story.lockIn("$10");
  assert.equal(story.grownSinceLock().length, 0);

  // A new essay lands after the lock.
  const essays = JSON.parse(store.get("tinker.essays.v1"));
  essays.push(essay("e_2", "second", 2));
  store.set("tinker.essays.v1", JSON.stringify(essays));
  const grown = story.grownSinceLock();
  assert.equal(grown.length, 1);
  assert.equal(grown[0].id, "e_2");
});

test("a seeded lock round-trips through load", () => {
  const { story } = loadInSandbox({
    essays: [essay("e_1", "words", 1)],
    seedStory: { ask: "$1.2m", lockedAt: 4242, lockedEssayIds: ["e_1"], storiesUrl: "https://beginner.work/you" },
  });
  const lock = story.getLock();
  assert.equal(lock.ask, "$1.2m");
  assert.equal(lock.lockedAt, 4242);
  assert.equal(lock.storiesUrl, "https://beginner.work/you");
});
