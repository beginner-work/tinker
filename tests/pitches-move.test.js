/* Unit tests for manual placement — window.tinkerPitches.moveWriting.
 *
 * The founder drags an essay onto a slide. A manual move is the founder
 * speaking, so unlike the automated upsertPhrase path it always wins:
 * the writing lands under the target heading, a displaced occupant
 * swaps into the source slot (nothing visible falls off the deck), and
 * the target heading is pinned so the next AI reorganization keeps the
 * founder's placement.
 *
 * pitches.js is browser-shaped, so we mount the same thin VM shim the
 * pitches-lock tests use and drive the public API.
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

test("moveWriting moves an essay to an empty slide and pins the destination", () => {
  const seedPitches = {
    pitches: [{
      id: "p_1",
      aiTitle: "Coffee",
      personalTitle: null,
      aiTitleSourceHash: null,
      deck: { "The Problem": [{ writingId: "e_1", offset: 0, length: 5, addedAt: 100 }] },
      meta: {},
      createdAt: 1,
      updatedAt: 1,
    }],
    activeId: "p_1",
  };
  const { pitches, store } = loadInSandbox({
    essays: [essay("e_1", "alpha beta gamma delta")],
    seedPitches,
  });

  assert.equal(pitches.moveWriting({ writingId: "e_1", deckHeading: "The Ask" }), true);

  const snap = pitches.snapshot();
  const deck = snap.pitches[0].deck;
  assert.equal(deck["The Problem"].length, 0, "source slot is empty after the move");
  assert.equal(deck["The Ask"].length, 1);
  assert.equal(deck["The Ask"][0].writingId, "e_1");
  assert.equal(pitches.isSectionLocked("p_1", "The Ask"), true, "destination is pinned");
  assert.equal(pitches.isSectionLocked("p_1", "The Problem"), false, "source is not pinned");

  // Persisted.
  const saved = JSON.parse(store.get("tinker.pitches.v1"));
  assert.equal(saved.pitches[0].deck["The Ask"][0].writingId, "e_1");
});

test("moveWriting swaps with the occupant so nothing falls off the deck", () => {
  const seedPitches = {
    pitches: [{
      id: "p_1",
      aiTitle: "Coffee",
      personalTitle: null,
      aiTitleSourceHash: null,
      deck: {
        "The Problem": [{ writingId: "e_1", offset: 0, length: 5, addedAt: 100 }],
        "The Ask": [{ writingId: "e_2", offset: 0, length: 5, addedAt: 200 }],
      },
      meta: {},
      createdAt: 1,
      updatedAt: 1,
    }],
    activeId: "p_1",
  };
  const { pitches } = loadInSandbox({
    essays: [essay("e_1", "alpha beta gamma"), essay("e_2", "delta epsilon zeta")],
    seedPitches,
  });

  assert.equal(pitches.moveWriting({ writingId: "e_1", deckHeading: "The Ask" }), true);

  const deck = pitches.snapshot().pitches[0].deck;
  assert.equal(deck["The Ask"][0].writingId, "e_1", "dragged essay holds the target slide");
  assert.equal(deck["The Problem"][0].writingId, "e_2", "displaced essay swaps into the source slide");
});

test("moveWriting overrides a pin on the target — the founder's drop wins", () => {
  const seedPitches = {
    pitches: [{
      id: "p_1",
      aiTitle: "Coffee",
      personalTitle: null,
      aiTitleSourceHash: null,
      deck: {
        "The Problem": [{ writingId: "e_1", offset: 0, length: 5, addedAt: 100 }],
        "The Ask": [{ writingId: "e_2", offset: 0, length: 5, addedAt: 200 }],
      },
      meta: { locked: { "The Ask": true } },
      createdAt: 1,
      updatedAt: 1,
    }],
    activeId: "p_1",
  };
  const { pitches } = loadInSandbox({
    essays: [essay("e_1", "alpha beta gamma"), essay("e_2", "delta epsilon zeta")],
    seedPitches,
  });

  assert.equal(pitches.moveWriting({ writingId: "e_1", deckHeading: "The Ask" }), true);
  const deck = pitches.snapshot().pitches[0].deck;
  assert.equal(deck["The Ask"][0].writingId, "e_1");
  assert.equal(pitches.isSectionLocked("p_1", "The Ask"), true, "target stays pinned for the new occupant");
});

test("moveWriting is a no-op for the same heading or an unknown writing", () => {
  const seedPitches = {
    pitches: [{
      id: "p_1",
      aiTitle: "Coffee",
      personalTitle: null,
      aiTitleSourceHash: null,
      deck: { "The Problem": [{ writingId: "e_1", offset: 0, length: 5, addedAt: 100 }] },
      meta: {},
      createdAt: 1,
      updatedAt: 1,
    }],
    activeId: "p_1",
  };
  const { pitches } = loadInSandbox({
    essays: [essay("e_1", "alpha beta gamma")],
    seedPitches,
  });

  assert.equal(pitches.moveWriting({ writingId: "e_1", deckHeading: "The Problem" }), false);
  assert.equal(pitches.moveWriting({ writingId: "e_missing", deckHeading: "The Ask" }), false);
  assert.equal(pitches.moveWriting({ writingId: "e_1", deckHeading: "Not A Heading" }), false);
  const deck = pitches.snapshot().pitches[0].deck;
  assert.equal(deck["The Problem"][0].writingId, "e_1", "deck unchanged");
});

test("after a manual move, the automated path can't move the pinned writing again", () => {
  const seedPitches = {
    pitches: [{
      id: "p_1",
      aiTitle: "Coffee",
      personalTitle: null,
      aiTitleSourceHash: null,
      deck: { "The Problem": [{ writingId: "e_1", offset: 0, length: 5, addedAt: 100 }] },
      meta: {},
      createdAt: 1,
      updatedAt: 1,
    }],
    activeId: "p_1",
  };
  const { pitches } = loadInSandbox({
    essays: [essay("e_1", "alpha beta gamma")],
    seedPitches,
  });

  pitches.moveWriting({ writingId: "e_1", deckHeading: "The Ask" });
  // A later auto-classify tries to relocate it — the pin holds.
  pitches.upsertPhrase({ pitchId: "p_1", deckHeading: "The Vision", writingId: "e_1", offset: 0, length: 5 });

  const deck = pitches.snapshot().pitches[0].deck;
  assert.equal((deck["The Vision"] || []).length, 0, "auto path can't move a hand-placed essay");
  assert.equal(deck["The Ask"][0].writingId, "e_1");
});
