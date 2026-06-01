/* Pure helpers for reconciling an already-paid Stripe subscription to a tinker
 * user (api/membership/reconcile.js does the I/O around these).
 *
 * Kept side-effect-free so they unit-test without the network or the Stripe
 * SDK, matching the style of api/_lib/stripe-checkout.js.
 */

"use strict";

const { PRESEED_TIER, ACTIVE_STATUSES } = require("./membership.js");

/** Trim/lowercase and shape-check an email. Stripe does the real matching;
 *  this just rejects obvious junk before we spend a round-trip on it. */
function normalizeEmail(raw) {
  if (typeof raw !== "string") return "";
  const e = raw.trim().toLowerCase();
  if (!e || e.length > 320) return "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return "";
  return e;
}

/** Period end moved onto the subscription *item* in recent Stripe API
 *  versions; older payloads keep it at the top level. Read whichever exists. */
function subscriptionPeriodEnd(sub) {
  if (!sub || typeof sub !== "object") return null;
  if (sub.current_period_end) return sub.current_period_end;
  const item = sub.items && sub.items.data && sub.items.data[0];
  return (item && item.current_period_end) || null;
}

function clean(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    if (obj[k] !== null && obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/**
 * Given every subscription found for a person's Stripe customer(s), return the
 * membership blob to store (keyed later by the tinker user_id), or null when
 * none of them entitle the buyer. Prefers the entitling subscription that
 * renews furthest out, so a fresh re-subscribe wins over a lapsed one.
 */
function pickMembershipFromSubscriptions(subs) {
  if (!Array.isArray(subs)) return null;
  const entitling = subs.filter(
    (s) => s && s.status && ACTIVE_STATUSES.includes(s.status)
  );
  if (entitling.length === 0) return null;
  entitling.sort(
    (a, b) => (subscriptionPeriodEnd(b) || 0) - (subscriptionPeriodEnd(a) || 0)
  );
  const sub = entitling[0];
  return clean({
    tier: PRESEED_TIER,
    status: sub.status,
    stripeCustomerId: sub.customer || null,
    stripeSubscriptionId: sub.id || null,
    currentPeriodEnd: subscriptionPeriodEnd(sub),
  });
}

module.exports = { normalizeEmail, subscriptionPeriodEnd, pickMembershipFromSubscriptions };
