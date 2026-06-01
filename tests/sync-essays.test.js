/* Regression test for src/renderer/sync.js essay hydrate handling.
 *
 * Bug: "All of my essays were removed from my pitches after I added a
 * new pitch." Adding a pitch publishes the freewrite (writing the essay
 * to localStorage on a 1500ms-debounced push) and then POSTs
 * /api/pitches/organize, which only *reads* essays — it never writes
 * them. If a hydrate races in before the debounced push lands, the
 * server still returns its pre-publish essays list. applyEssaysFromServer
 * used to overwrite localStorage wholesale, dropping every essay the push
 * hadn't delivered yet. It now merges by id (like applyDraftsFromServer),
 * so local essays survive while the server stays authoritative for the
 * essays it already knows.
 *
 * sync.js is browser-shaped (window, localStorage, fetch). We mount a
 * thin shim, seed localStorage, stub fetch per-kind, and drive
 * window.tinkerSync.hydrate().
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SYNC_SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "renderer", "sync.js"),
  "utf8",
);

// serverData: map of kind -> value returned in the { data } envelope.
// A kind absent from the map (or mapped to undefined) responds with no
// `data` property, which fetchKind treats as null ("no row yet").
function loadInSandbox({ localEssays = [], serverData = {} } = {}) {
  const store = new Map();
  store.set("tinker_jwt", "test-token");
  if (localEssays.length) {
    store.set("tinker.essays.v1", JSON.stringify(localEssays));
  }

  const localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
  };

  const fetchCalls = [];
  function fetch(url, opts = {}) {
    fetchCalls.push({ url, method: opts.method || "GET" });
    const kind = String(url).replace("/api/user-data/", "");
    if ((opts.method || "GET") === "GET") {
      const has = Object.prototype.hasOwnProperty.call(serverData, kind);
      const json = has ? { data: serverData[kind] } : {};
      return Promise.resolve({ ok: true, json: () => Promise.resolve(json) });
    }
    // PUT (push) — accept and ignore.
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  }

  const win = {
    localStorage,
    addEventListener() {},
    dispatchEvent() {},
  };
  win.window = win;

  const sandbox = {
    window: win,
    localStorage,
    document: { readyState: "complete", addEventListener() {} },
    console,
    setTimeout,
    clearTimeout,
    fetch,
    CustomEvent: function CustomEvent(name, init) {
      this.type = name;
      this.detail = init && init.detail;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(SYNC_SRC, sandbox);
  return { api: win.tinkerSync, store, fetchCalls };
}

function essaysOf(store) {
  const raw = store.get("tinker.essays.v1");
  return raw ? JSON.parse(raw) : null;
}

test("hydrate keeps a local-only essay when the server's list is stale", async () => {
  const local = [
    { id: "e_new", title: "Just published", body: "x", createdAt: 2000 },
    { id: "e_old", title: "Known essay", body: "y", createdAt: 1000 },
  ];
  // Server has only the older essay — the push for e_new hasn't landed.
  const { api, store } = loadInSandbox({
    localEssays: local,
    serverData: { essays: [{ id: "e_old", title: "Known essay", body: "y", createdAt: 1000 }] },
  });
  await api.hydrate();
  const after = essaysOf(store);
  const ids = after.map((e) => e.id).sort();
  assert.deepEqual(ids, ["e_new", "e_old"], "the just-published essay must survive the hydrate");
});

test("hydrate does not wipe local essays when the server returns an empty list", async () => {
  const local = [{ id: "e_1", title: "Mine", body: "z", createdAt: 1000 }];
  const { api, store } = loadInSandbox({
    localEssays: local,
    serverData: { essays: [] },
  });
  await api.hydrate();
  const after = essaysOf(store);
  assert.equal(after.length, 1, "an empty server list must not clobber local essays");
  assert.equal(after[0].id, "e_1");
});

test("hydrate leaves local essays untouched when the server has no row yet (null)", async () => {
  const local = [{ id: "e_1", title: "Mine", body: "z", createdAt: 1000 }];
  const { api, store } = loadInSandbox({ localEssays: local, serverData: {} });
  await api.hydrate();
  const after = essaysOf(store);
  assert.equal(after.length, 1);
  assert.equal(after[0].id, "e_1");
});

test("hydrate accepts a newer server copy of an essay it already knows", async () => {
  const local = [{ id: "e_1", title: "Old title", body: "z", createdAt: 1000 }];
  const { api, store } = loadInSandbox({
    localEssays: local,
    serverData: { essays: [{ id: "e_1", title: "New title", body: "z", createdAt: 2000 }] },
  });
  await api.hydrate();
  const after = essaysOf(store);
  assert.equal(after.length, 1);
  assert.equal(after[0].title, "New title", "the newer server copy wins for a known essay");
});
