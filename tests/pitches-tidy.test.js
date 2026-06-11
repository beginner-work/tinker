/* Unit tests for the no-AI tidy — window.tinkerPitches.tidyPitches.
 *
 * The deterministic half of "reorganize": drop phrase records whose
 * writing is gone (or whose offsets no longer resolve), prune pitches
 * left with nothing — keeping any pitch the founder personally named —
 * and report exactly what happened. No network, no model.
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
    fetch: () => { throw new Error("tidy must never touch the network"); },
    CustomEvent: function CustomEvent(name, init) { this.type = name; this.detail = init && init.detail; },
  };
  vm.createContext(sandbox);
  vm.runInContext(PITCHES_SRC, sandbox);
  return { pitches: win.tinkerPitches, store };
}

function essay(id, body) {
  return { id, kind: "essay", title: id, body, author: "you" };
}

test("tidyPitches drops records pointing at deleted writings and prunes the emptied pitch", () => {
  const seedPitches = {
    pitches: [
      {
        id: "p_live",
        aiTitle: "Coffee",
        personalTitle: null,
        aiTitleSourceHash: null,
        deck: { "The Problem": [{ writingId: "e_live", offset: 0, length: 5, addedAt: 100 }] },
        meta: {},
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "p_stale",
        aiTitle: "Ghost",
        personalTitle: null,
        aiTitleSourceHash: null,
        deck: { "The Vision": [{ writingId: "e_deleted", offset: 0, length: 5, addedAt: 100 }] },
        meta: {},
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    activeId: "p_stale",
  };
  const { pitches } = loadInSandbox({
    essays: [essay("e_live", "alpha beta gamma")],
    seedPitches,
  });

  const result = pitches.tidyPitches();
  assert.equal(result.droppedRecords, 1);
  assert.equal(result.prunedPitches, 1);

  const snap = pitches.snapshot();
  assert.equal(snap.pitches.length, 1);
  assert.equal(snap.pitches[0].id, "p_live");
  assert.equal(snap.activeId, null, "activeId pointing at the pruned pitch is cleared");
});

test("tidyPitches drops records whose offsets no longer resolve in the writing", () => {
  const seedPitches = {
    pitches: [{
      id: "p_1",
      aiTitle: "Coffee",
      personalTitle: null,
      aiTitleSourceHash: null,
      deck: {
        "The Problem": [{ writingId: "e_1", offset: 0, length: 5, addedAt: 100 }],
        // Offset runs past the end of the (shortened) essay body.
        "The Vision": [{ writingId: "e_1", offset: 500, length: 40, addedAt: 100 }],
      },
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

  const result = pitches.tidyPitches();
  assert.equal(result.droppedRecords, 1);
  assert.equal(result.prunedPitches, 0);
  const deck = pitches.snapshot().pitches[0].deck;
  assert.equal(deck["The Problem"].length, 1, "resolvable record survives");
  assert.equal(deck["The Vision"].length, 0, "unresolvable record is dropped");
});

test("tidyPitches keeps an empty pitch the founder personally named", () => {
  const seedPitches = {
    pitches: [{
      id: "p_named",
      aiTitle: null,
      personalTitle: "my keeper",
      aiTitleSourceHash: null,
      deck: { "The Problem": [{ writingId: "e_gone", offset: 0, length: 5, addedAt: 100 }] },
      meta: {},
      createdAt: 1,
      updatedAt: 1,
    }],
    activeId: "p_named",
  };
  const { pitches } = loadInSandbox({ essays: [], seedPitches });

  const result = pitches.tidyPitches();
  assert.equal(result.droppedRecords, 1);
  assert.equal(result.prunedPitches, 0, "founder-named pitch survives empty");
  assert.equal(pitches.snapshot().pitches.length, 1);
});

test("tidyPitches on a clean deck reports nothing to do and does not persist", () => {
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
    essays: [essay("e_1", "alpha beta gamma")],
    seedPitches,
  });
  // Capture the persisted blob before tidy; a clean tidy must not rewrite it.
  const before = store.get("tinker.pitches.v1");

  const result = pitches.tidyPitches();
  assert.equal(result.droppedRecords, 0);
  assert.equal(result.prunedPitches, 0);
  assert.equal(store.get("tinker.pitches.v1"), before, "no-op tidy leaves storage untouched");
});
