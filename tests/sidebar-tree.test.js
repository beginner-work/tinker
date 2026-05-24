/* Smoke tests for src/renderer/sidebar-tree.js + src/renderer/pitches.js.
 *
 * The modules are browser-shaped (touch localStorage, document,
 * window). We mount a thin DOM shim, load pitches.js first (it owns
 * the data) and then sidebar-tree.js (it delegates to pitches via
 * window.tinkerPitches), and drive the public API on
 * window.tinkerTree. The classifier endpoint is never invoked here —
 * these tests cover the deck-management state machine.
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
const TREE_SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "renderer", "sidebar-tree.js"),
  "utf8",
);

function loadInSandbox({ drafts = [], essays = [], hidden = [], seedTree = null, seedPitches = null } = {}) {
  const store = new Map();
  if (drafts.length) store.set("tinker.drafts.v1", JSON.stringify(drafts));
  if (essays.length) store.set("tinker.essays.v1", JSON.stringify(essays));
  if (hidden.length) store.set("tinker.seeds.hidden.v1", JSON.stringify(hidden));
  if (seedTree) store.set("tinker.tree.v1", JSON.stringify(seedTree));
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
    createElement() {
      const node = {
        appendChild() {},
        setAttribute() {},
        removeAttribute() {},
        addEventListener() {},
        getAttribute() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        classList: { add() {}, remove() {} },
        style: {},
        children: [],
        attributes: {},
      };
      return node;
    },
    createTreeWalker() { return { nextNode() { return null; } }; },
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
    NodeFilter: { SHOW_TEXT: 0x4 },
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => fn(),
    fetch: () => Promise.reject(new Error("network disabled in tests")),
    CustomEvent: function CustomEvent(name, init) { this.type = name; this.detail = init && init.detail; },
  };
  vm.createContext(sandbox);
  // pitches.js first — sidebar-tree.js reads from window.tinkerPitches.
  vm.runInContext(PITCHES_SRC, sandbox);
  vm.runInContext(TREE_SRC, sandbox);
  return { api: win.tinkerTree, pitches: win.tinkerPitches, store };
}

function deckOf(snapshot, pitchIndex) {
  return snapshot.pitches[pitchIndex || 0].deck;
}

test("cold-start blob is empty and not persisted before any upsert", () => {
  const { pitches, store } = loadInSandbox();
  const snap = pitches.snapshot();
  // pitches is an Array but in a different VM realm, so deepEqual to
  // a literal [] would compare prototypes — length check is enough.
  assert.equal(snap.pitches.length, 0);
  assert.equal(snap.activeId, null);
  assert.equal(store.has("tinker.pitches.v1"), false);
});

test("upsertPhrase creates the first pitch when none exists and persists", () => {
  const draft = {
    id: "d_abc",
    stitched: { body: "i worked so hard but i'm still stressed about everything" },
  };
  const { api, pitches, store } = loadInSandbox({ drafts: [draft] });
  api.upsertPhrase({
    deckHeading: "The Problem",
    writingId: "d_abc",
    offset: 0,
    length: "i worked so hard but i'm still stressed".length,
  });
  const snap = pitches.snapshot();
  assert.equal(snap.pitches.length, 1);
  const deck = deckOf(snap);
  assert.equal(deck["The Problem"].length, 1);
  assert.equal(deck["The Problem"][0].writingId, "d_abc");
  assert.equal(snap.pitches[0].meta.mostRecentlyTouched, "The Problem");
  assert.ok(store.has("tinker.pitches.v1"), "pitches blob must be persisted");
});

test("upsertPhrase rejects an unknown deck heading", () => {
  const { api, pitches } = loadInSandbox();
  api.upsertPhrase({
    deckHeading: "Not A Real Heading",
    writingId: "d_xyz",
    offset: 0,
    length: 10,
  });
  const snap = pitches.snapshot();
  assert.equal(snap.pitches.length, 0);
});

test("upsertPhrase moves a writing to a new heading when the classifier changes its mind", () => {
  const draft = {
    id: "d_abc",
    stitched: { body: "AI is making our workplace more toxic right now today, everyone says so" },
  };
  const { api, pitches } = loadInSandbox({ drafts: [draft] });
  api.upsertPhrase({ deckHeading: "The Problem", writingId: "d_abc", offset: 0, length: 30 });
  api.upsertPhrase({ deckHeading: "Why Now?", writingId: "d_abc", offset: 0, length: 30 });
  const deck = deckOf(pitches.snapshot());
  assert.equal(deck["The Problem"].length, 0, "old heading must be empty after move");
  assert.equal(deck["Why Now?"].length, 1);
  assert.equal(deck["Why Now?"][0].writingId, "d_abc");
});

test("upsertPhrase trims to the most-recent phrase per heading", () => {
  const drafts = Array.from({ length: 7 }, (_, i) => ({
    id: `d_${i}`,
    stitched: { body: `body ${i} the founder wrote something here today right now okay sure` },
  }));
  const { api, pitches } = loadInSandbox({ drafts });
  let when = 1000;
  for (const d of drafts) {
    api.upsertPhrase({
      deckHeading: "The Problem",
      writingId: d.id,
      offset: 0,
      length: 10,
      addedAt: when++,
    });
  }
  const deck = deckOf(pitches.snapshot());
  assert.equal(deck["The Problem"].length, 1);
  assert.equal(deck["The Problem"][0].writingId, "d_6");
});

test("clearWritingFromTree removes the writing from every heading", () => {
  const draft = { id: "d_abc", stitched: { body: "some body content right here in the draft" } };
  const { api, pitches } = loadInSandbox({ drafts: [draft] });
  api.upsertPhrase({ deckHeading: "The Product", writingId: "d_abc", offset: 0, length: 20 });
  api.clearWritingFromTree("d_abc");
  const deck = deckOf(pitches.snapshot());
  assert.equal(deck["The Product"].length, 0);
});

test("isWritingHidden returns true when the writing's earth/seed is in the hidden set", () => {
  const drafts = [
    { id: "d_open", seed: "Cafe", stitched: { body: "x x x x" } },
    { id: "d_hidden", seed: "Home", stitched: { body: "x x x x" } },
  ];
  const { api } = loadInSandbox({ drafts, hidden: ["home"] });
  assert.equal(api.isWritingHidden("d_open"), false);
  assert.equal(api.isWritingHidden("d_hidden"), true);
});

test("markClassifyFailed and markClassifySucceeded toggle the active pitch's failure timestamp", () => {
  const draft = { id: "d_abc", stitched: { body: "some body content" } };
  const { api, pitches } = loadInSandbox({ drafts: [draft] });
  // Create a pitch by upserting a phrase first.
  api.upsertPhrase({ deckHeading: "The Problem", writingId: "d_abc", offset: 0, length: 10 });
  let snap = pitches.snapshot();
  assert.equal(snap.pitches[0].meta.lastClassifyFailedAt, null);
  api.markClassifyFailed();
  snap = pitches.snapshot();
  assert.ok(snap.pitches[0].meta.lastClassifyFailedAt);
  api.markClassifySucceeded();
  snap = pitches.snapshot();
  assert.equal(snap.pitches[0].meta.lastClassifyFailedAt, null);
});

test("legacy tree blob migrates into pitches[0] on first load", () => {
  const draft = { id: "d_abc", stitched: { body: "the barber gave me a hundred bucks today, what a day" } };
  const legacyTree = {
    "The Problem": [{ writingId: "d_abc", offset: 0, length: 33, addedAt: 1 }],
    _meta: { mostRecentlyTouched: "The Problem", expanded: { "The Problem": true } },
  };
  const { pitches } = loadInSandbox({ drafts: [draft], seedTree: legacyTree });
  const snap = pitches.snapshot();
  assert.equal(snap.pitches.length, 1, "legacy tree wraps as one pitch");
  assert.equal(snap.pitches[0].aiTitle, null, "AI title fills in once the namer runs");
  assert.equal(snap.pitches[0].personalTitle, null);
  const deck = deckOf(snap);
  assert.equal(deck["The Problem"].length, 1);
  assert.equal(deck["The Problem"][0].writingId, "d_abc");
});

test("older pitches.v1 blob with `title`+autoTitled migrates into ai/personal split", () => {
  // An autoTitled pitch keeps its AI title; a manually-renamed
  // pitch moves the old title to personalTitle so the founder's
  // input isn't lost.
  const seedPitches = {
    pitches: [
      { id: "p_auto", title: "Beans", autoTitled: true, deck: {}, meta: {}, createdAt: 1 },
      { id: "p_named", title: "MyThing", autoTitled: false, deck: {}, meta: {}, createdAt: 2 },
    ],
    activeId: "p_auto",
  };
  const { pitches } = loadInSandbox({ seedPitches });
  const snap = pitches.snapshot();
  assert.equal(snap.pitches[0].aiTitle, "Beans");
  assert.equal(snap.pitches[0].personalTitle, null);
  assert.equal(snap.pitches[1].aiTitle, null);
  assert.equal(snap.pitches[1].personalTitle, "MyThing");
});

test("setPersonalTitle sets the personal label without touching aiTitle", () => {
  const seedPitches = {
    pitches: [{
      id: "p_one",
      aiTitle: "Beans",
      personalTitle: null,
      deck: {},
      meta: {},
      createdAt: 1,
    }],
    activeId: "p_one",
  };
  const { pitches } = loadInSandbox({ seedPitches });
  assert.equal(pitches.setPersonalTitle("p_one", "  my coffee thing  "), true);
  const after = pitches.snapshot();
  assert.equal(after.pitches[0].personalTitle, "my coffee thing");
  assert.equal(after.pitches[0].aiTitle, "Beans", "AI title must be untouched");
});

test("setPersonalTitle with empty string clears the personal label", () => {
  const seedPitches = {
    pitches: [{
      id: "p_one",
      aiTitle: "Beans",
      personalTitle: "MyCoffee",
      deck: {},
      meta: {},
      createdAt: 1,
    }],
    activeId: "p_one",
  };
  const { pitches } = loadInSandbox({ seedPitches });
  pitches.setPersonalTitle("p_one", "   ");
  assert.equal(pitches.snapshot().pitches[0].personalTitle, null);
  assert.equal(pitches.snapshot().pitches[0].aiTitle, "Beans");
});

test("setPersonalTitle accepts multi-word, lowercase, and punctuation", () => {
  const seedPitches = {
    pitches: [{ id: "p_one", aiTitle: null, personalTitle: null, deck: {}, meta: {}, createdAt: 1 }],
    activeId: "p_one",
  };
  const { pitches } = loadInSandbox({ seedPitches });
  pitches.setPersonalTitle("p_one", "my side hustle (2026)");
  assert.equal(pitches.snapshot().pitches[0].personalTitle, "my side hustle (2026)");
});

test("setActivePitch switches the active selection", () => {
  // Hand-seed two pitches so the test doesn't depend on the rehome flow.
  const draftA = { id: "d_a", stitched: { body: "alpha body content here" } };
  const draftB = { id: "d_b", stitched: { body: "beta body content here" } };
  const seedPitches = {
    pitches: [
      {
        id: "p_one",
        aiTitle: "First",
        personalTitle: null,
        deck: { "The Problem": [{ writingId: "d_a", offset: 0, length: 5, addedAt: 1 }] },
        meta: { mostRecentlyTouched: null, expanded: {}, lastClassifyFailedAt: null },
        createdAt: 1000,
      },
      {
        id: "p_two",
        aiTitle: "Second",
        personalTitle: null,
        deck: { "A Persona": [{ writingId: "d_b", offset: 0, length: 4, addedAt: 1 }] },
        meta: { mostRecentlyTouched: null, expanded: {}, lastClassifyFailedAt: null },
        createdAt: 2000,
      },
    ],
    activeId: "p_one",
  };
  const { pitches } = loadInSandbox({ drafts: [draftA, draftB], seedPitches });
  assert.equal(pitches.getActivePitchId(), "p_one");
  pitches.setActivePitch("p_two");
  assert.equal(pitches.getActivePitchId(), "p_two");
});

test("default active pick = most robust pitch (most covered headings)", () => {
  const draftA = { id: "d_a", stitched: { body: "alpha body content here for the test" } };
  const draftB = { id: "d_b", stitched: { body: "beta body content here for the test" } };
  const seedPitches = {
    pitches: [
      {
        id: "p_thin",
        aiTitle: "Thin",
        personalTitle: null,
        deck: {
          "The Problem": [{ writingId: "d_a", offset: 0, length: 5, addedAt: 1 }],
        },
        meta: {},
        createdAt: 1000,
      },
      {
        id: "p_robust",
        aiTitle: "Robust",
        personalTitle: null,
        deck: {
          "The Problem": [{ writingId: "d_a", offset: 0, length: 5, addedAt: 1 }],
          "A Persona": [{ writingId: "d_b", offset: 0, length: 4, addedAt: 1 }],
          "Why Now?": [{ writingId: "d_b", offset: 5, length: 4, addedAt: 1 }],
        },
        meta: {},
        createdAt: 2000,
      },
    ],
    activeId: null, // explicit null → auto-pick
  };
  const { pitches } = loadInSandbox({ drafts: [draftA, draftB], seedPitches });
  assert.equal(pitches.getActivePitchId(), "p_robust");
});
