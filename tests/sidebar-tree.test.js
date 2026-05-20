/* Smoke tests for src/renderer/sidebar-tree.js.
 *
 * The module is browser-shaped (touches localStorage, document,
 * window). We mount a thin DOM shim and bootstrap the IIFE inside
 * that environment, then drive its public API (upsertPhrase,
 * clearWritingFromTree, etc.) and read back the tree blob from our
 * fake localStorage. The classifier endpoint is never invoked here —
 * these tests cover the client's tree-management state machine.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "renderer", "sidebar-tree.js"),
  "utf8",
);

function loadInSandbox({ drafts = [], essays = [], hidden = [], seedTree = null } = {}) {
  const store = new Map();
  if (drafts.length) store.set("tinker.drafts.v1", JSON.stringify(drafts));
  if (essays.length) store.set("tinker.essays.v1", JSON.stringify(essays));
  if (hidden.length) store.set("tinker.seeds.hidden.v1", JSON.stringify(hidden));
  if (seedTree) store.set("tinker.tree.v1", JSON.stringify(seedTree));

  const localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  };

  // Minimal Element + querySelector shim. We don't render in the
  // tests — the IIFE's mount lookup just returns null and render()
  // bails. The tree API path doesn't depend on the DOM beyond that.
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
    fetch: () => Promise.reject(new Error("network disabled in tests")),
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { api: win.tinkerTree, store };
}

test("cold-start tree is empty and the blob isn't persisted before any upsert", () => {
  const { api, store } = loadInSandbox();
  const snap = api.snapshot();
  // The IIFE's load returns an emptyTree() with the _meta scaffold,
  // but does NOT write to localStorage until something mutates.
  assert.deepEqual(Object.keys(snap).filter((k) => k !== "_meta"), []);
  assert.equal(store.has("tinker.tree.v1"), false);
});

test("upsertPhrase adds a phrase under the right heading and persists", () => {
  const draft = {
    id: "d_abc",
    stitched: { body: "i worked so hard but i'm still stressed about everything" },
  };
  const { api, store } = loadInSandbox({ drafts: [draft] });
  api.upsertPhrase({
    deckHeading: "The Problem",
    writingId: "d_abc",
    offset: 0,
    length: "i worked so hard but i'm still stressed".length,
  });
  const snap = api.snapshot();
  assert.equal(snap["The Problem"].length, 1);
  assert.equal(snap["The Problem"][0].writingId, "d_abc");
  assert.equal(snap._meta.mostRecentlyTouched, "The Problem");
  assert.ok(store.has("tinker.tree.v1"), "tree blob must be persisted");
});

test("upsertPhrase rejects an unknown deck heading", () => {
  const { api } = loadInSandbox();
  api.upsertPhrase({
    deckHeading: "Not A Real Heading",
    writingId: "d_xyz",
    offset: 0,
    length: 10,
  });
  const snap = api.snapshot();
  assert.deepEqual(Object.keys(snap).filter((k) => k !== "_meta"), []);
});

test("upsertPhrase moves a writing to a new heading when the classifier changes its mind", () => {
  const draft = {
    id: "d_abc",
    stitched: { body: "AI is making our workplace more toxic right now today, everyone says so" },
  };
  const { api } = loadInSandbox({ drafts: [draft] });
  api.upsertPhrase({
    deckHeading: "The Problem",
    writingId: "d_abc",
    offset: 0,
    length: 30,
  });
  api.upsertPhrase({
    deckHeading: "Why Now?",
    writingId: "d_abc",
    offset: 0,
    length: 30,
  });
  const snap = api.snapshot();
  assert.equal(snap["The Problem"], undefined, "old heading must be empty after move");
  assert.equal(snap["Why Now?"].length, 1);
  assert.equal(snap["Why Now?"][0].writingId, "d_abc");
});

test("upsertPhrase trims to the two most-recent phrases per heading", () => {
  const drafts = Array.from({ length: 7 }, (_, i) => ({
    id: `d_${i}`,
    stitched: { body: `body ${i} the founder wrote something here today right now okay sure` },
  }));
  const { api } = loadInSandbox({ drafts });
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
  const snap = api.snapshot();
  assert.equal(snap["The Problem"].length, 2);
  // Most-recent retained, older entries dropped.
  const ids = snap["The Problem"].map((p) => p.writingId);
  assert.ok(ids.includes("d_6"));
  assert.ok(ids.includes("d_5"));
  assert.ok(!ids.includes("d_4"));
  assert.ok(!ids.includes("d_0"));
});

test("clearWritingFromTree removes the writing from every heading", () => {
  const draft = { id: "d_abc", stitched: { body: "some body content right here in the draft" } };
  const { api } = loadInSandbox({ drafts: [draft] });
  api.upsertPhrase({
    deckHeading: "The Product",
    writingId: "d_abc",
    offset: 0,
    length: 20,
  });
  api.clearWritingFromTree("d_abc");
  const snap = api.snapshot();
  assert.equal(snap["The Product"], undefined);
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

test("markClassifyFailed and markClassifySucceeded toggle the failure timestamp", () => {
  const { api } = loadInSandbox();
  assert.equal(api.snapshot()._meta.lastClassifyFailedAt, null);
  api.markClassifyFailed();
  assert.ok(api.snapshot()._meta.lastClassifyFailedAt);
  api.markClassifySucceeded();
  assert.equal(api.snapshot()._meta.lastClassifyFailedAt, null);
});

test("recovery clears a v0.102-shaped tree blob", () => {
  // A blob with a Seed-shaped top-level key (not one of the eleven
  // deck-heading literals) — this should be wiped on first boot.
  const stale = {
    "seed:cafe": [{ writingId: "d_a", offset: 0, length: 4 }],
  };
  const { store } = loadInSandbox({ seedTree: stale });
  assert.equal(store.has("tinker.tree.v1"), false, "v0.102-shaped blob must be cleared");
});

test("recovery preserves a v0.103-shaped tree blob", () => {
  const draft = { id: "d_abc", stitched: { body: "the barber gave me a hundred bucks today, what a day" } };
  const good = {
    "The Problem": [{ writingId: "d_abc", offset: 0, length: 33, addedAt: 1 }],
    _meta: { mostRecentlyTouched: "The Problem", expanded: { "The Problem": true } },
  };
  const { api, store } = loadInSandbox({ drafts: [draft], seedTree: good });
  assert.ok(store.has("tinker.tree.v1"));
  const snap = api.snapshot();
  assert.equal(snap["The Problem"].length, 1);
});
