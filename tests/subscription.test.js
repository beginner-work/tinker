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
// `fetchImpl` lets a test stand in for the network so refresh() can be
// exercised; `events` collects dispatched CustomEvents.
function freshSubscription(seed = {}, fetchImpl) {
  const store = new Map(Object.entries(seed));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const events = [];
  const window = {
    localStorage,
    dispatchEvent: (e) => { events.push(e); return true; },
  };
  if (fetchImpl) window.fetch = fetchImpl;
  const ctx = vm.createContext({
    window,
    fetch: fetchImpl,
    CustomEvent: class CustomEvent {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
  });
  vm.runInContext(SUB_SRC, ctx);
  return { sub: window.tinkerSubscription, store, events };
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

test("setTier fires tinker:subscription-changed only when the tier changes", () => {
  const { sub, events } = freshSubscription();
  sub.setTier("pre-seed");
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "tinker:subscription-changed");
  sub.setTier("pre-seed"); // no change
  assert.equal(events.length, 1);
  sub.setTier("free"); // change back
  assert.equal(events.length, 2);
});

// ── refresh(): reconcile against the server (Stripe source of truth) ───

test("refresh adopts the server's tier (Stripe authoritative)", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => ({ tier: "pre-seed", active: true }) };
  };
  const { sub } = freshSubscription({ tinker_jwt: "tok" }, fetchImpl);
  const tier = await sub.refresh();
  assert.equal(tier, "pre-seed");
  assert.equal(sub.isPitchUnlocked(), true);
  assert.equal(calls[0].url, "/api/subscription");
  assert.equal(calls[0].opts.headers.Authorization, "Bearer tok");
});

test("refresh downgrades when Stripe says the sub lapsed", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ tier: "free", active: false }) });
  const { sub } = freshSubscription({ tinker_subscription_tier: "pre-seed", tinker_jwt: "tok" }, fetchImpl);
  assert.equal(sub.isPitchUnlocked(), true); // optimistic cache
  const tier = await sub.refresh();
  assert.equal(tier, "free");
  assert.equal(sub.isPitchUnlocked(), false);
});

test("refresh won't downgrade a just-paid founder during the grace window", async () => {
  // Server still says free because Stripe's webhook hasn't landed yet.
  const fetchImpl = async () => ({ ok: true, json: async () => ({ tier: "free", active: false }) });
  const { sub } = freshSubscription({ tinker_jwt: "tok" }, fetchImpl);
  sub.setTier("pre-seed", { optimistic: true }); // post-checkout optimistic unlock
  const tier = await sub.refresh();
  assert.equal(tier, "pre-seed", "grace window keeps the just-paid founder unlocked");
  assert.equal(sub.isPitchUnlocked(), true);
});

test("refresh keeps the cache when offline (never downgrades on a blip)", async () => {
  const fetchImpl = async () => { throw new Error("offline"); };
  const { sub } = freshSubscription({ tinker_subscription_tier: "pre-seed", tinker_jwt: "tok" }, fetchImpl);
  const tier = await sub.refresh();
  assert.equal(tier, "pre-seed");
  assert.equal(sub.isPitchUnlocked(), true);
});

test("refresh is a no-op (returns cache) when signed out", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, json: async () => ({ tier: "pre-seed" }) }; };
  const { sub } = freshSubscription({}, fetchImpl); // no tinker_jwt
  const tier = await sub.refresh();
  assert.equal(tier, "free");
  assert.equal(called, false, "must not call the server without a token");
});

// ── Wiring ────────────────────────────────────────────────────────────

test("renderer records the tier on the unlocked return", () => {
  const renderer = fs.readFileSync(
    path.resolve(__dirname, "..", "src", "renderer", "renderer.js"),
    "utf8",
  );
  assert.match(renderer, /tinkerSubscription[\s\S]*setTier\(\s*["']pre-seed["']/);
});

test("the Pitch gate reads the persisted tier", () => {
  const sidebar = fs.readFileSync(
    path.resolve(__dirname, "..", "src", "renderer", "sidebar-tree.js"),
    "utf8",
  );
  assert.match(sidebar, /tinkerSubscription\.isPitchUnlocked\(\)/);
});

test("the Receipts sidebar item is replaced by a live Plan/tier status", () => {
  const index = fs.readFileSync(
    path.resolve(__dirname, "..", "src", "renderer", "index.html"),
    "utf8",
  );
  assert.doesNotMatch(index, /nav-receipts/, "the old Receipts item must be gone");
  assert.doesNotMatch(index, />\s*Receipts\s*</, "no Receipts label");
  assert.match(index, /id="nav-plan"/, "a Plan status item must exist");
  assert.match(index, /data-plan-tier/, "the Plan item must have a tier slot");
  assert.match(index, /src="\.\/subscription-status\.js"/, "the status module must be loaded");
});

test("subscription-status renders the tier and routes by plan", () => {
  const statusSrc = fs.readFileSync(
    path.resolve(__dirname, "..", "src", "renderer", "subscription-status.js"),
    "utf8",
  );
  assert.match(statusSrc, /getTier\(\)/, "must read the current tier");
  assert.match(statusSrc, /isPitchUnlocked\(\)/, "must branch on the unlock state");
  assert.match(statusSrc, /tinkerShowPitchQr\(\)/, "pre-seed taps open the QR surface");
  assert.match(statusSrc, /refresh/, "must reconcile against Stripe");
});

test("checkout open-out carries the founder's uid for attribution", () => {
  const sidebar = fs.readFileSync(
    path.resolve(__dirname, "..", "src", "renderer", "sidebar-tree.js"),
    "utf8",
  );
  assert.match(sidebar, /\/api\/me/, "must resolve the founder's userId");
  assert.match(sidebar, /set\(\s*["']uid["']/, "unlock URL must carry ?uid");
});
