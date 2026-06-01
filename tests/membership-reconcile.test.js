/* Unit tests for the membership-reconcile helpers.
 *
 * The pure shape-mapping (api/_lib/stripe-reconcile.js) maps Stripe
 * subscription shapes to the entitlement blob the endpoint stores; no network
 * or Stripe SDK needed. The auto-reconcile policy (api/_lib/membership-
 * reconcile.js) decides when a status read should re-probe Stripe and what to
 * report when it can't — also pure, and tested here without touching I/O.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeEmail,
  subscriptionPeriodEnd,
  pickMembershipFromSubscriptions,
} = require("../api/_lib/stripe-reconcile.js");
const {
  RECONCILE_COOLDOWN_SEC,
  shouldAutoReconcile,
  autoReconcileForStatus,
} = require("../api/_lib/membership-reconcile.js");

test("normalizeEmail trims, lowercases, and shape-checks", () => {
  assert.equal(normalizeEmail("  Tyler.Lindow@Gmail.com "), "tyler.lindow@gmail.com");
  assert.equal(normalizeEmail("not-an-email"), "");
  assert.equal(normalizeEmail("a@b"), "");
  assert.equal(normalizeEmail(""), "");
  assert.equal(normalizeEmail(null), "");
  assert.equal(normalizeEmail(undefined), "");
});

test("subscriptionPeriodEnd reads top-level or item-level period end", () => {
  assert.equal(subscriptionPeriodEnd({ current_period_end: 123 }), 123);
  assert.equal(
    subscriptionPeriodEnd({ items: { data: [{ current_period_end: 456 }] } }),
    456
  );
  assert.equal(subscriptionPeriodEnd({}), null);
  assert.equal(subscriptionPeriodEnd(null), null);
});

test("pickMembershipFromSubscriptions maps an entitling sub to the blob", () => {
  const subs = [
    { id: "sub_old", customer: "cus_1", status: "canceled", items: { data: [{ current_period_end: 1 }] } },
    { id: "sub_live", customer: "cus_1", status: "active", items: { data: [{ current_period_end: 1782932460 }] } },
  ];
  assert.deepEqual(pickMembershipFromSubscriptions(subs), {
    tier: "pre-seed",
    status: "active",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_live",
    currentPeriodEnd: 1782932460,
  });
});

test("past_due and trialing still entitle (mirrors ACTIVE_STATUSES)", () => {
  assert.equal(
    pickMembershipFromSubscriptions([{ id: "s", customer: "c", status: "trialing" }]).status,
    "trialing"
  );
  assert.equal(
    pickMembershipFromSubscriptions([{ id: "s", customer: "c", status: "past_due" }]).status,
    "past_due"
  );
});

test("pickMembershipFromSubscriptions prefers the sub renewing furthest out", () => {
  const subs = [
    { id: "sub_a", customer: "c", status: "active", items: { data: [{ current_period_end: 1000 }] } },
    { id: "sub_b", customer: "c", status: "active", items: { data: [{ current_period_end: 2000 }] } },
  ];
  assert.equal(pickMembershipFromSubscriptions(subs).stripeSubscriptionId, "sub_b");
});

test("pickMembershipFromSubscriptions returns null when nothing entitles", () => {
  assert.equal(pickMembershipFromSubscriptions([{ id: "x", status: "canceled" }]), null);
  assert.equal(pickMembershipFromSubscriptions([]), null);
  assert.equal(pickMembershipFromSubscriptions(null), null);
});

// ── Auto-reconcile policy (api/_lib/membership-reconcile.js) ────────────────

test("shouldAutoReconcile probes when there's no membership row yet", () => {
  assert.equal(shouldAutoReconcile(null, 1_000_000), true);
  assert.equal(shouldAutoReconcile(undefined, 1_000_000), true);
});

test("shouldAutoReconcile never re-probes an already-entitled member", () => {
  assert.equal(shouldAutoReconcile({ tier: "pre-seed", status: "active" }, 1_000_000), false);
  assert.equal(shouldAutoReconcile({ tier: "pre-seed", status: "past_due" }, 1_000_000), false);
});

test("shouldAutoReconcile honors the cooldown stamp, then probes again once stale", () => {
  const now = 1_000_000;
  // Just checked → skip.
  assert.equal(shouldAutoReconcile({ checkedAt: now - 60 }, now), false);
  // Checked longer ago than the cooldown → probe again.
  assert.equal(shouldAutoReconcile({ checkedAt: now - RECONCILE_COOLDOWN_SEC - 1 }, now), true);
});

test("shouldAutoReconcile still probes a lapsed (canceled) member with no recent stamp", () => {
  // A canceled row isn't entitled, and without a fresh checkedAt we should look
  // again — they may have re-subscribed outside tinker's checkout.
  assert.equal(shouldAutoReconcile({ tier: "pre-seed", status: "canceled" }, 1_000_000), true);
});

test("autoReconcileForStatus is a no-op without a Stripe key (no I/O)", async () => {
  const data = { tier: "pre-seed", status: "canceled" };
  assert.equal(await autoReconcileForStatus("u", data, ""), data);
  assert.equal(await autoReconcileForStatus("u", null, undefined), null);
});

test("autoReconcileForStatus returns an entitled row untouched (never hits Stripe)", async () => {
  const data = { tier: "pre-seed", status: "active", currentPeriodEnd: 123 };
  // A live key is present, but an entitled member short-circuits before any
  // network call — if it didn't, this would try to reach Stripe and throw.
  assert.equal(await autoReconcileForStatus("u", data, "sk_live_x"), data);
});

test("autoReconcileForStatus respects the cooldown stamp before reaching Stripe", async () => {
  const now = 2_000_000;
  const data = { checkedAt: now - 60 };
  assert.equal(await autoReconcileForStatus("u", data, "sk_live_x", now), data);
});
