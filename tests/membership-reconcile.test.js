/* Unit tests for the pure membership-reconcile helpers
 * (api/_lib/stripe-reconcile.js). No network or Stripe SDK — these just map
 * Stripe subscription shapes to the entitlement blob the endpoint stores.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeEmail,
  subscriptionPeriodEnd,
  pickMembershipFromSubscriptions,
} = require("../api/_lib/stripe-reconcile.js");

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
