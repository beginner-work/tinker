/* Unit tests for section locking on window.tinkerPitches.
 *
 * A locked deck beat is frozen against automated placement: the founder
 * pins a slide that feels good, and neither the "Refresh all pitches"
 * redistribute nor a newly auto-classified writing may change it. These
 * tests cover the client half of that contract — the lock API, its
 * persistence, and the upsertPhrase guards. (The server organizer's half
 * lives in pitches-organize.test.js.)
 *
 * pitches.js is browser-shaped (localStorage, document, window), so we
 * mount the same thin VM shim the reading-order / sidebar-tree tests use
 * and drive the public API.
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

function essay(id, body) {
  return { id, kind: "essay", title: id, body, author: "you" };
}

// A pitch holding one phrase under `heading`, optionally with `heading`
// locked. Bodies are long enough for the offset/length to resolve.
function seedPitch(id, heading, writingId, locked) {
  return {
    pitches: [{
      id,
      aiTitle: "Coffee",
      personalTitle: null,
      aiTitleSourceHash: null,
      deck: { [heading]: [{ writingId, offset: 0, length: 5, addedAt: 100 }] },
      meta: locked ? { locked: { [heading]: true } } : {},
      createdAt: 1,
      updatedAt: 1,
    }],
    activeId: id,
  };
}

test("setSectionLock pins a beat; isSectionLocked + lockedHeadings reflect it and it persists", () => {
  const { pitches, store } = loadInSandbox({
    essays: [essay("e_1", "alpha beta gamma delta")],
    seedPitches: seedPitch("p_1", "The Problem", "e_1", false),
  });

  assert.equal(pitches.isSectionLocked("p_1", "The Problem"), false);

  assert.equal(pitches.setSectionLock("p_1", "The Problem", true), true);
  assert.equal(pitches.isSectionLocked("p_1", "The Problem"), true);
  // Array.from normalizes the sandbox-realm array into this realm so
  // deepStrictEqual's prototype check doesn't trip on the realm boundary.
  assert.deepEqual(Array.from(pitches.lockedHeadings("p_1")), ["The Problem"]);

  // Persisted into localStorage as part of the blob.
  const saved = JSON.parse(store.get("tinker.pitches.v1"));
  assert.equal(saved.pitches[0].meta.locked["The Problem"], true);

  // Toggle clears it again.
  assert.equal(pitches.toggleSectionLock("p_1", "The Problem"), true);
  assert.equal(pitches.isSectionLocked("p_1", "The Problem"), false);
  assert.deepEqual(Array.from(pitches.lockedHeadings("p_1")), []);
});

test("a seeded lock round-trips through load + normalizeBlob", () => {
  const { pitches } = loadInSandbox({
    essays: [essay("e_1", "alpha beta gamma delta")],
    seedPitches: seedPitch("p_1", "The Problem", "e_1", true),
  });
  assert.equal(pitches.isSectionLocked("p_1", "The Problem"), true);
  assert.deepEqual(Array.from(pitches.lockedHeadings("p_1")), ["The Problem"]);
});

test("upsertPhrase refuses to evict a phrase pinned in a locked target beat", () => {
  const { pitches } = loadInSandbox({
    essays: [essay("e_lock", "alpha beta gamma"), essay("e_other", "delta epsilon zeta")],
    seedPitches: seedPitch("p_1", "The Problem", "e_lock", true),
  });

  pitches.upsertPhrase({ pitchId: "p_1", deckHeading: "The Problem", writingId: "e_other", offset: 0, length: 4 });

  const snap = pitches.snapshot();
  const slot = snap.pitches[0].deck["The Problem"];
  assert.equal(slot.length, 1);
  assert.equal(slot[0].writingId, "e_lock", "locked phrase is not evicted");
});

test("upsertPhrase leaves a locked writing pinned — won't move or duplicate it", () => {
  const { pitches } = loadInSandbox({
    essays: [essay("e_lock", "alpha beta gamma")],
    seedPitches: seedPitch("p_1", "The Problem", "e_lock", true),
  });

  // Try to move the locked writing into a different (unlocked) beat.
  pitches.upsertPhrase({ pitchId: "p_1", deckHeading: "The Vision", writingId: "e_lock", offset: 0, length: 5 });

  const snap = pitches.snapshot();
  assert.equal((snap.pitches[0].deck["The Vision"] || []).length, 0, "not moved into the new beat");
  assert.equal(snap.pitches[0].deck["The Problem"][0].writingId, "e_lock", "stays pinned where it was");
});
