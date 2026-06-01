/* Unit tests for the pre-seed membership identity bridge:
 *   - membership.js       entitlement predicate
 *   - stripe-checkout.js  Checkout Session param builder
 *   - stripe-webhook.js   signature verification + event → membership mapping
 *
 * These are all pure functions, so no Stytch/Prisma/network stubbing needed.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { isActiveMembership, PRESEED_TIER } = require("../api/_lib/membership.js");
const { buildCheckoutParams } = require("../api/_lib/stripe-checkout.js");
const { constructEvent, membershipFromEvent } = require("../api/_lib/stripe-webhook.js");

// ── Entitlement predicate ──────────────────────────────────────────────────

test("isActiveMembership: active/trialing/past_due entitle, others don't", () => {
  assert.equal(isActiveMembership({ tier: "pre-seed", status: "active" }), true);
  assert.equal(isActiveMembership({ tier: "pre-seed", status: "trialing" }), true);
  assert.equal(isActiveMembership({ tier: "pre-seed", status: "past_due" }), true);
  assert.equal(isActiveMembership({ tier: "pre-seed", status: "canceled" }), false);
  assert.equal(isActiveMembership({ tier: "pre-seed", status: "unpaid" }), false);
  assert.equal(isActiveMembership({ status: "active" }), false, "no tier = not a member");
  assert.equal(isActiveMembership(null), false);
  assert.equal(isActiveMembership(undefined), false);
});

// ── Checkout param builder ─────────────────────────────────────────────────

test("buildCheckoutParams stamps the user onto session AND subscription", () => {
  const p = buildCheckoutParams({ userId: "user-abc", origin: "https://tinker.app" });
  assert.equal(p.get("mode"), "subscription");
  assert.equal(p.get("client_reference_id"), "user-abc");
  assert.equal(p.get("metadata[userId]"), "user-abc");
  // The crucial stamp: later subscription.* webhooks only carry the
  // subscription, so identity must live there too.
  assert.equal(p.get("subscription_data[metadata][userId]"), "user-abc");
});

test("buildCheckoutParams defaults the return path to the tinker root", () => {
  const p = buildCheckoutParams({ userId: "u", origin: "https://tinker.app" });
  assert.equal(p.get("success_url"), "https://tinker.app/?status=success");
  assert.equal(p.get("cancel_url"), "https://tinker.app/?status=cancelled");
});

test("buildCheckoutParams honors a safe returnPath and ignores off-site ones", () => {
  const ok = buildCheckoutParams({ userId: "u", origin: "https://tinker.app", returnPath: "/welcome" });
  assert.equal(ok.get("success_url"), "https://tinker.app/welcome?status=success");
  const evil = buildCheckoutParams({ userId: "u", origin: "https://tinker.app", returnPath: "https://evil.com" });
  assert.equal(evil.get("success_url"), "https://tinker.app/?status=success", "off-site path falls back to root");
});

test("buildCheckoutParams uses STRIPE_PRICE_PRESEED when set, else inline price", () => {
  const prev = process.env.STRIPE_PRICE_PRESEED;
  try {
    process.env.STRIPE_PRICE_PRESEED = "price_123";
    const withId = buildCheckoutParams({ userId: "u", origin: "" });
    assert.equal(withId.get("line_items[0][price]"), "price_123");
    assert.equal(withId.get("line_items[0][price_data][unit_amount]"), null);

    delete process.env.STRIPE_PRICE_PRESEED;
    const inline = buildCheckoutParams({ userId: "u", origin: "" });
    assert.equal(inline.get("line_items[0][price]"), null);
    assert.equal(inline.get("line_items[0][price_data][unit_amount]"), "900");
    assert.equal(inline.get("line_items[0][price_data][recurring][interval]"), "month");
  } finally {
    if (prev === undefined) delete process.env.STRIPE_PRICE_PRESEED;
    else process.env.STRIPE_PRICE_PRESEED = prev;
  }
});

test("buildCheckoutParams refuses an unauthenticated build", () => {
  assert.throws(() => buildCheckoutParams({ userId: "", origin: "" }), /userId required/);
});

// ── Webhook signature verification ─────────────────────────────────────────

const SECRET = "whsec_test_secret";

function sign(rawBody, secret, t) {
  const sig = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex");
  return `t=${t},v1=${sig}`;
}

test("constructEvent accepts a correctly signed payload", () => {
  const t = Math.floor(Date.now() / 1000);
  const raw = JSON.stringify({ type: "ping", data: { object: {} } });
  const event = constructEvent(raw, sign(raw, SECRET, t), SECRET);
  assert.equal(event.type, "ping");
});

test("constructEvent rejects a tampered body", () => {
  const t = Math.floor(Date.now() / 1000);
  const raw = JSON.stringify({ type: "ping", data: { object: {} } });
  const header = sign(raw, SECRET, t);
  assert.throws(() => constructEvent(raw + "x", header, SECRET), /Signature verification failed/);
});

test("constructEvent rejects a wrong secret, missing header, and missing secret", () => {
  const t = Math.floor(Date.now() / 1000);
  const raw = "{}";
  assert.throws(() => constructEvent(raw, sign(raw, SECRET, t), "whsec_other"), /Signature verification failed/);
  assert.throws(() => constructEvent(raw, "", SECRET), /Missing or malformed signature/);
  assert.throws(() => constructEvent(raw, sign(raw, SECRET, t), ""), /not configured/);
});

test("constructEvent rejects a stale timestamp outside tolerance", () => {
  const t = 1000; // ancient
  const raw = "{}";
  assert.throws(
    () => constructEvent(raw, sign(raw, SECRET, t), SECRET, { nowSec: 100000, toleranceSec: 300 }),
    /Timestamp outside tolerance/
  );
});

// ── Event → membership mapping ─────────────────────────────────────────────

test("checkout.session.completed (paid subscription) grants pre-seed", () => {
  const m = membershipFromEvent({
    type: "checkout.session.completed",
    data: { object: { mode: "subscription", payment_status: "paid", client_reference_id: "user-1", customer: "cus_1", subscription: "sub_1" } },
  });
  assert.deepEqual(m, {
    userId: "user-1",
    data: { tier: PRESEED_TIER, status: "active", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" },
  });
});

test("checkout.session.completed falls back to metadata.userId", () => {
  const m = membershipFromEvent({
    type: "checkout.session.completed",
    data: { object: { mode: "subscription", payment_status: "paid", metadata: { userId: "user-2" } } },
  });
  assert.equal(m.userId, "user-2");
});

test("unpaid or non-subscription or identity-less checkouts grant nothing", () => {
  assert.equal(membershipFromEvent({ type: "checkout.session.completed", data: { object: { mode: "subscription", payment_status: "unpaid", client_reference_id: "u" } } }), null);
  assert.equal(membershipFromEvent({ type: "checkout.session.completed", data: { object: { mode: "payment", payment_status: "paid", client_reference_id: "u" } } }), null);
  assert.equal(membershipFromEvent({ type: "checkout.session.completed", data: { object: { mode: "subscription", payment_status: "paid" } } }), null);
});

test("subscription.updated maps Stripe status through and reads metadata identity", () => {
  const m = membershipFromEvent({
    type: "customer.subscription.updated",
    data: { object: { id: "sub_9", customer: "cus_9", status: "past_due", current_period_end: 1234, metadata: { userId: "user-9" } } },
  });
  assert.deepEqual(m, {
    userId: "user-9",
    data: { tier: PRESEED_TIER, status: "past_due", stripeCustomerId: "cus_9", stripeSubscriptionId: "sub_9", currentPeriodEnd: 1234 },
  });
});

test("subscription.deleted records canceled", () => {
  const m = membershipFromEvent({
    type: "customer.subscription.deleted",
    data: { object: { id: "sub_9", status: "active", metadata: { userId: "user-9" } } },
  });
  assert.equal(m.data.status, "canceled");
});

test("subscription events without identity, and unknown events, are ignored", () => {
  assert.equal(membershipFromEvent({ type: "customer.subscription.updated", data: { object: { id: "sub", status: "active" } } }), null);
  assert.equal(membershipFromEvent({ type: "invoice.paid", data: { object: {} } }), null);
  assert.equal(membershipFromEvent(null), null);
});
