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

/**
 * The membership status a Stripe subscription maps to. A paused subscription
 * keeps Stripe's own `status` as "active" (only billing is suspended via
 * `pause_collection`), so we surface our own "paused" status for it — that's
 * what lets feature gates lock the paid surface while billing is stopped, and
 * what the sidebar reads to offer "Resume" instead of "Pause". Otherwise we
 * pass Stripe's status straight through.
 */
function effectiveSubscriptionStatus(sub) {
  if (!sub || typeof sub !== "object") return null;
  if (sub.pause_collection) return "paused";
  return sub.status || null;
}

function clean(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    if (obj[k] !== null && obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/** Shape one Stripe subscription into the membership blob we persist. */
function membershipFromSubscription(sub) {
  if (!sub || typeof sub !== "object") return null;
  return clean({
    tier: PRESEED_TIER,
    status: effectiveSubscriptionStatus(sub),
    stripeCustomerId: sub.customer || null,
    stripeSubscriptionId: sub.id || null,
    currentPeriodEnd: subscriptionPeriodEnd(sub),
  });
}

/** Latest-renewing first, so a fresh subscribe wins over a lapsed one. */
function byPeriodEndDesc(a, b) {
  return (subscriptionPeriodEnd(b) || 0) - (subscriptionPeriodEnd(a) || 0);
}

/**
 * Given every subscription found for a person's Stripe customer(s), return the
 * membership blob to store (keyed later by the tinker user_id), or null when
 * none of them are the buyer's to surface. Prefers the entitling subscription
 * that renews furthest out; failing that, a paused subscription is still the
 * member's, so we surface it (status "paused") so they can resume it — even
 * from a device that never saw the original checkout.
 */
function pickMembershipFromSubscriptions(subs) {
  if (!Array.isArray(subs)) return null;
  const byStatus = (wanted) =>
    subs
      .filter((s) => wanted.includes(effectiveSubscriptionStatus(s)))
      .sort(byPeriodEndDesc);

  const entitling = byStatus(ACTIVE_STATUSES);
  if (entitling.length) return membershipFromSubscription(entitling[0]);

  const paused = byStatus(["paused"]);
  if (paused.length) return membershipFromSubscription(paused[0]);

  return null;
}

module.exports = {
  normalizeEmail,
  subscriptionPeriodEnd,
  effectiveSubscriptionStatus,
  membershipFromSubscription,
  pickMembershipFromSubscriptions,
};
