/* subscription.js — persisted plan-tier contract.
 *
 * The pre-seed unlock has to survive reloads and app restarts: a founder
 * who paid should tap Pitch and land on their QR code every time, not get
 * bounced back to checkout. subscription.js owns that persisted tier;
 * these tests exercise it functionally (against a localStorage stub) and
 * pin the wiring in renderer.js / sidebar-tree.js.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SUB_SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "renderer", "subscription.js"),
  "utf8",
);

// Build a fresh window (with a Map-backed localStorage) and run
// subscription.js inside it, returning window.tinkerSubscription.
function freshSubscription(seed = {}) {
  const store = new Map(Object.entries(seed));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const window = { localStorage };
  const ctx = vm.createContext({ window });
  vm.runInContext(SUB_SRC, ctx);
  return { sub: window.tinkerSubscription, store };
}

test("defaults to the free tier, Pitch locked", () => {
  const { sub } = freshSubscription();
  assert.equal(sub.getTier(), "free");
  assert.equal(sub.isPitchUnlocked(), false);
});

test("setTier('pre-seed') unlocks Pitch and persists", () => {
  const { sub, store } = freshSubscription();
  sub.setTier("pre-seed");
  assert.equal(sub.getTier(), "pre-seed");
  assert.equal(sub.isPitchUnlocked(), true);
  assert.equal(store.get("tinker_subscription_tier"), "pre-seed");
});

test("a returning founder stays unlocked (reads from storage)", () => {
  // Simulate a fresh boot where storage already holds the paid tier.
  const { sub } = freshSubscription({ tinker_subscription_tier: "pre-seed" });
  assert.equal(sub.isPitchUnlocked(), true);
});

test("migrates the legacy boolean flag to a tier", () => {
  const { sub } = freshSubscription({ tinker_pitch_unlocked: "1" });
  assert.equal(sub.getTier(), "pre-seed");
  assert.equal(sub.isPitchUnlocked(), true);
});

test("clear() drops back to free", () => {
  const { sub } = freshSubscription({ tinker_subscription_tier: "pre-seed" });
  sub.clear();
  assert.equal(sub.getTier(), "free");
  assert.equal(sub.isPitchUnlocked(), false);
});

// ── Wiring ────────────────────────────────────────────────────────────

test("renderer records the tier on the unlocked return", () => {
  const renderer = fs.readFileSync(
    path.resolve(__dirname, "..", "src", "renderer", "renderer.js"),
    "utf8",
  );
  assert.match(renderer, /tinkerSubscription[\s\S]*setTier\(\s*["']pre-seed["']\s*\)/);
});

test("the Pitch gate reads the persisted tier", () => {
  const sidebar = fs.readFileSync(
    path.resolve(__dirname, "..", "src", "renderer", "sidebar-tree.js"),
    "utf8",
  );
  assert.match(sidebar, /tinkerSubscription\.isPitchUnlocked\(\)/);
});
