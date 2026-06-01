/* Unit tests for the sidebar membership row's pure formatter
 * (src/renderer/membership.js → window.tinkerMembership.formatMembership).
 *
 * The module is browser-shaped (touches localStorage, document, window) but
 * guards its bootstrap behind `typeof document !== "undefined"` and exposes
 * the pure formatter on window. We load it in a vm sandbox with a document
 * whose getElementById returns null, so hydrate() no-ops and we can drive the
 * formatter directly — the same load-the-source approach the other renderer
 * smoke tests use.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "renderer", "membership.js"),
  "utf8",
);

function loadFormatter() {
  const sandbox = {
    window: {},
    document: {
      readyState: "complete",
      getElementById() { return null; },
      addEventListener() {},
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  sandbox.window.addEventListener = () => {};
  sandbox.window.location = { pathname: "/", origin: "https://tinker.app" };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.window.tinkerMembership.formatMembership;
}

test("active pre-seed shows tier, monthly price, and renewal date", () => {
  const formatMembership = loadFormatter();
  // 2026-07-01 in UTC seconds; assert on the parts that don't drift with TZ.
  const view = formatMembership({ active: true, tier: "pre-seed", status: "active", currentPeriodEnd: 1782000000 });
  assert.equal(view.active, true);
  assert.equal(view.label, "Pre-seed · $9/mo");
  assert.match(view.sub, /^Renews /);
  assert.equal(view.cta, "");
});

test("trialing reads as a free trial that renews", () => {
  const formatMembership = loadFormatter();
  const view = formatMembership({ active: true, tier: "pre-seed", status: "trialing", currentPeriodEnd: 1782000000 });
  assert.equal(view.label, "Pre-seed · $9/mo");
  assert.match(view.sub, /Free trial — renews /);
});

test("past_due active member is nudged to update their card", () => {
  const formatMembership = loadFormatter();
  const view = formatMembership({ active: true, tier: "pre-seed", status: "past_due" });
  assert.equal(view.active, true);
  assert.equal(view.sub, "Payment past due — update card");
});

test("active member with no period end still reads as active", () => {
  const formatMembership = loadFormatter();
  const view = formatMembership({ active: true, tier: "pre-seed", status: "active" });
  assert.equal(view.sub, "Active");
});

test("no membership reads as a free plan with an upgrade CTA", () => {
  const formatMembership = loadFormatter();
  for (const status of [null, {}, { active: false, tier: null, status: null }]) {
    const view = formatMembership(status);
    assert.equal(view.active, false);
    assert.equal(view.label, "Free plan");
    assert.equal(view.sub, "Pre-seed is $9/mo");
    assert.equal(view.cta, "Upgrade");
  }
});

test("canceled or unpaid (active:false) falls back to the free view even with a tier", () => {
  const formatMembership = loadFormatter();
  const view = formatMembership({ active: false, tier: "pre-seed", status: "canceled" });
  assert.equal(view.active, false);
  assert.equal(view.label, "Free plan");
  assert.equal(view.cta, "Upgrade");
});

test("an unknown tier even if marked active falls back to the free view", () => {
  const formatMembership = loadFormatter();
  const view = formatMembership({ active: true, tier: "mythical", status: "active" });
  assert.equal(view.active, false);
  assert.equal(view.label, "Free plan");
});

test("the free view offers to restore an existing subscription", () => {
  const formatMembership = loadFormatter();
  for (const status of [null, {}, { active: false, tier: "pre-seed", status: "canceled" }]) {
    assert.equal(formatMembership(status).restore, true);
  }
});

test("an active member is not offered restore", () => {
  const formatMembership = loadFormatter();
  const view = formatMembership({ active: true, tier: "pre-seed", status: "active" });
  assert.equal(view.restore, false);
});
