/* Unit tests for window.tinkerPitches.readingOrder — the page sequence
 * the read view's book spread walks to find the essay that comes *next*
 * after the one being read (and, on the last slide, the one *before*).
 *
 * pitches.js is browser-shaped (localStorage, document, window), so we
 * mount the same thin VM shim the sidebar-tree tests use and drive the
 * public API. No network / classifier is touched here — these tests
 * cover the pure deck-walk.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PITCHES_SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "renderer", "pitches.js"),
  "utf8",
);

function loadInSandbox({ drafts = [], essays = [], seedPitches = null } = {}) {
  const store = new Map();
  if (drafts.length) store.set("tinker.drafts.v1", JSON.stringify(drafts));
  if (essays.length) store.set("tinker.essays.v1", JSON.stringify(essays));
  if (seedPitches) store.set("tinker.pitches.v1", JSON.stringify(seedPitches));

  const localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  };
  const document = {
    readyState: "complete",
    addEventListener() {},
    querySelector() { return null; },
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
    fetch: () => Promise.reject(new Error("network disabled in tests")),
    CustomEvent: function CustomEvent(name, init) { this.type = name; this.detail = init && init.detail; },
  };
  vm.createContext(sandbox);
  vm.runInContext(PITCHES_SRC, sandbox);
  return { pitches: win.tinkerPitches, store };
}

// An essay record with a body long enough to slice a phrase from.
function essay(id, body) {
  return { id, kind: "essay", title: id, body, author: "you" };
}

// A phrase record covering the first `len` chars of a writing.
function rec(writingId, len) {
  return { writingId, offset: 0, length: len };
}

function pitchWithDeck(id, deck) {
  return {
    pitches: [{ id, aiTitle: "Pitch", personalTitle: null, deck, createdAt: 1000 }],
    activeId: id,
  };
}

// readingOrder returns arrays/objects built inside the VM realm, whose
// prototypes differ from the test realm's — so deepStrictEqual on them
// trips on the prototype check. Round-trip through JSON to compare by
// value (the entries are plain { writingId, heading } anyway).
function plain(v) {
  return JSON.parse(JSON.stringify(v));
}

test("readingOrder lists covered headings' writings in deck order", () => {
  const essays = [
    essay("e_a", "alpha body that is plenty long for a phrase"),
    essay("e_b", "bravo body that is plenty long for a phrase"),
    essay("e_c", "charlie body that is plenty long for a phrase"),
  ];
  // Seed the headings out of deck order — readingOrder must still return
  // them in deck order (The Problem → The Product → The Ask).
  const seed = pitchWithDeck("p_1", {
    "The Ask": [rec("e_c", 7)],
    "The Problem": [rec("e_a", 5)],
    "The Product": [rec("e_b", 5)],
  });
  const { pitches } = loadInSandbox({ essays, seedPitches: seed });
  assert.deepEqual(plain(pitches.readingOrder("p_1")), [
    { writingId: "e_a", heading: "The Problem" },
    { writingId: "e_b", heading: "The Product" },
    { writingId: "e_c", heading: "The Ask" },
  ]);
});

test("readingOrder de-dupes a writing that backs several slides to its earliest heading", () => {
  const essays = [
    essay("e_a", "alpha body that is plenty long for a phrase"),
    essay("e_b", "bravo body that is plenty long for a phrase"),
  ];
  const seed = pitchWithDeck("p_1", {
    "The Problem": [rec("e_a", 5)],
    "Why Now?": [rec("e_a", 5)],   // same writing, later heading → not repeated
    "The Ask": [rec("e_b", 5)],
  });
  const { pitches } = loadInSandbox({ essays, seedPitches: seed });
  assert.deepEqual(plain(pitches.readingOrder("p_1")), [
    { writingId: "e_a", heading: "The Problem" },
    { writingId: "e_b", heading: "The Ask" },
  ]);
});

test("readingOrder skips headings whose phrase no longer resolves", () => {
  const essays = [
    essay("e_a", "alpha body that is plenty long for a phrase"),
    essay("e_short", "tiny"),
  ];
  const seed = pitchWithDeck("p_1", {
    "The Problem": [rec("e_a", 5)],
    "The Product": [rec("e_short", 999)], // offset+length past body end → unresolvable
    "The Ask": [rec("e_missing", 5)],     // no such writing → unresolvable
  });
  const { pitches } = loadInSandbox({ essays, seedPitches: seed });
  assert.deepEqual(plain(pitches.readingOrder("p_1")), [
    { writingId: "e_a", heading: "The Problem" },
  ]);
});

test("readingOrder resolves not-yet-published drafts too", () => {
  const drafts = [
    { id: "d_a", stitched: { body: "draft alpha body long enough for a phrase" } },
  ];
  const essays = [essay("e_b", "bravo body that is plenty long for a phrase")];
  const seed = pitchWithDeck("p_1", {
    "The Problem": [rec("d_a", 5)],
    "The Ask": [rec("e_b", 5)],
  });
  const { pitches } = loadInSandbox({ drafts, essays, seedPitches: seed });
  assert.deepEqual(plain(pitches.readingOrder("p_1")), [
    { writingId: "d_a", heading: "The Problem" },
    { writingId: "e_b", heading: "The Ask" },
  ]);
});

test("readingOrder returns [] for an unknown pitch", () => {
  const { pitches } = loadInSandbox();
  assert.deepEqual(plain(pitches.readingOrder("nope")), []);
});
