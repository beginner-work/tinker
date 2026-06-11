/* Unit tests for src/renderer/story.js — the curated verbatim story.
 *
 * The story shows, per slide category, the MOST RECENT essay that fits
 * it — full essays, word for word, in slide order. Locking it in
 * snapshots that selection with the founder's ask and publishes it to
 * their public profile via /api/publish/booklet. These tests drive the
 * data API in the same thin VM shim the renderer tests use; the DOM
 * mounts are absent, so render paths no-op and the model logic is what
 * gets exercised.
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

// A tagged writing: `slide` is the category the one-shot classifier
// assigned at publish time.
function essay(id, body, createdAt, slide, extra) {
  return Object.assign(
    {
      id, kind: "essay", title: "Title of " + id, body, author: "you", createdAt,
      slide: slide || null, slideCheckedAt: slide === undefined ? 0 : createdAt,
    },
    extra || {},
  );
}

test("storyPieces: per category, the most recent essay wins, in slide order", () => {
  const { story } = loadInSandbox({
    essays: [
      essay("e_ask_old", "the old ask", 1000, "The Ask"),
      essay("e_problem", "the pain, exactly as written", 2000, "The Problem"),
      essay("e_ask_new", "i need three hundred thousand dollars", 3000, "The Ask"),
      essay("e_untagged", "fits nothing yet", 1500, null),
    ],
  });
  const pieces = story.storyPieces();
  assert.deepEqual(
    Array.from(pieces.map((p) => p.id)),
    ["e_problem", "e_ask_new"],
    "slide order (Problem before Ask), newest take per category",
  );
  assert.equal(pieces[1].slide, "The Ask");
  assert.equal(
    pieces[1].body,
    "i need three hundred thousand dollars",
    "bodies pass through verbatim",
  );
});

test("storyPieces excludes archived writings even when tagged", () => {
  const { story } = loadInSandbox({
    essays: [
      essay("e_live", "alive", 1000, "The Problem"),
      essay("e_gone", "put away", 2000, "The Problem", { archived: true }),
    ],
  });
  const pieces = story.storyPieces();
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0].id, "e_live", "the archived newer take does not displace the live one");
});

test("allWritings returns everything non-archived, oldest first, verbatim", () => {
  const { story } = loadInSandbox({
    essays: [
      essay("e_new", "newest words", 3000, null),
      essay("e_old", "the OLDEST words —\n\nwith their line breaks", 1000, "The Vision"),
      { id: "e_status", kind: "status", title: null, body: "a quick thought", createdAt: 2000 },
    ],
  });
  const order = story.allWritings();
  assert.deepEqual(Array.from(order.map((e) => e.id)), ["e_old", "e_status", "e_new"]);
  assert.equal(order[0].body, "the OLDEST words —\n\nwith their line breaks");
  assert.equal(order[1].kind, "status");
});

test("essaysForSlide lists every take in a class, newest first; the newest is the pitch", () => {
  const { story } = loadInSandbox({
    essays: [
      essay("e_ask_v1", "first take", 1000, "The Ask"),
      essay("e_ask_v3", "third take", 3000, "The Ask"),
      essay("e_ask_v2", "second take", 2000, "The Ask"),
      essay("e_other", "different slide", 1500, "The Team"),
    ],
  });
  const takes = story.essaysForSlide("The Ask");
  assert.deepEqual(
    Array.from(takes.map((t) => t.id)),
    ["e_ask_v3", "e_ask_v2", "e_ask_v1"],
    "newest first",
  );
  const pitch = story.storyPieces().find((p) => p.slide === "The Ask");
  assert.equal(pitch.id, takes[0].id, "the pitch shows the newest take");
  assert.deepEqual(Array.from(story.essaysForSlide("Not A Slide")), []);
});

test("wordCount counts only the curated story", () => {
  const { story } = loadInSandbox({
    essays: [
      essay("e_in", "one two three", 1000, "The Problem"),
      essay("e_out", "these words are not in the story", 2000, null),
    ],
  });
  assert.equal(story.wordCount(), 3);
});

test("the story API exposes no in-progress surface — published work only", () => {
  const { story } = loadInSandbox({
    drafts: [
      { id: "d_1", title: "Untitled draft", updatedAt: 300, transcript: [{ q: "?", a: "real words" }] },
    ],
    essays: [essay("e_1", "published words", 1000, "The Problem")],
  });
  assert.equal(story.draftsInProgress, undefined, "drafts never reach the story");
  assert.deepEqual(Array.from(story.storyPieces().map((p) => p.id)), ["e_1"]);
});

test("lockIn snapshots the curated story, keeps the ask verbatim, and publishes the booklet", async () => {
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
    essays: [
      essay("e_ask", "the ask words", 2000, "The Ask"),
      essay("e_problem", "the problem words", 1000, "The Problem"),
      essay("e_untagged", "not part of the story", 1500, null),
    ],
    fetchImpl,
  });

  const result = await story.lockIn("  $300k  ");
  assert.equal(result.ok, true);
  assert.equal(sentUrl, "/api/publish/booklet");
  assert.equal(sentBody.pitches.length, 1);
  assert.equal(sentBody.pitches[0].slug, "story");
  assert.deepEqual(
    Array.from(sentBody.pitches[0].stories.map((s) => s.body)),
    ["the problem words", "the ask words"],
    "the booklet carries the curated pieces, verbatim, in slide order",
  );

  const lock = story.getLock();
  assert.equal(lock.ask, "$300k", "the ask is kept as typed (trimmed)");
  assert.ok(lock.lockedAt > 0);
  assert.deepEqual(Array.from(lock.lockedEssayIds), ["e_problem", "e_ask"]);
  assert.equal(lock.storiesUrl, "https://beginner.work/you#stories");

  // Persisted for the sync layer to pick up.
  const saved = JSON.parse(store.get("tinker.story.v1"));
  assert.equal(saved.ask, "$300k");
});

test("lockIn refuses an empty ask, an empty story, and a signed-out session", async () => {
  const ok = { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
  const { story } = loadInSandbox({
    essays: [essay("e_1", "words", 1, "The Problem")],
    fetchImpl: () => Promise.resolve(ok),
  });
  const noAsk = await story.lockIn("   ");
  assert.equal(noAsk.ok, false);
  assert.match(noAsk.error, /number/i);

  const empty = loadInSandbox({ essays: [], fetchImpl: () => Promise.resolve(ok) });
  const noStory = await empty.story.lockIn("$10");
  assert.equal(noStory.ok, false);

  const signedOut = loadInSandbox({
    essays: [essay("e_1", "words", 1, "The Problem")],
    fetchImpl: () => Promise.resolve(ok),
    token: null,
  });
  const noToken = await signedOut.story.lockIn("$10");
  assert.equal(noToken.ok, false);
  assert.match(noToken.error, /sign in/i);
});

test("a failed publish leaves the lock unset", async () => {
  const { story } = loadInSandbox({
    essays: [essay("e_1", "words", 1, "The Problem")],
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

test("grownSinceLock reports slides whose piece changed after the lock", async () => {
  const fetchImpl = () => Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ ok: true }),
  });
  const { story, store } = loadInSandbox({
    essays: [essay("e_1", "first take on the ask", 1000, "The Ask")],
    fetchImpl,
  });
  assert.deepEqual(Array.from(story.grownSinceLock()), [], "never locked → nothing has 'grown'");

  await story.lockIn("$10");
  assert.equal(story.grownSinceLock().length, 0);

  // A newer essay takes over The Ask after the lock.
  const essays = JSON.parse(store.get("tinker.essays.v1"));
  essays.push(essay("e_2", "newer take on the ask", 2000, "The Ask"));
  store.set("tinker.essays.v1", JSON.stringify(essays));
  const grown = story.grownSinceLock();
  assert.equal(grown.length, 1);
  assert.equal(grown[0].id, "e_2");
});

test("a seeded lock round-trips through load", () => {
  const { story } = loadInSandbox({
    essays: [essay("e_1", "words", 1, "The Problem")],
    seedStory: { ask: "$1.2m", lockedAt: 4242, lockedEssayIds: ["e_1"], storiesUrl: "https://beginner.work/you" },
  });
  const lock = story.getLock();
  assert.equal(lock.ask, "$1.2m");
  assert.equal(lock.lockedAt, 4242);
  assert.equal(lock.storiesUrl, "https://beginner.work/you");
});
