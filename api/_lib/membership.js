/* Pre-seed membership entitlement — the row tinker checks to decide whether
 * a user has paid for the membership purchased via Stripe.
 *
 * Stored as one row in the shared TinkerUserData table, kind="membership",
 * keyed by the Stytch user_id (the same identity every other tinker row uses).
 * The Stripe webhook (api/stripe/webhook.js) writes it; feature gates read it.
 *
 *   data shape: {
 *     tier: "pre-seed",
 *     status: "active" | "trialing" | "past_due" | "canceled" | ...,
 *     stripeCustomerId, stripeSubscriptionId, currentPeriodEnd
 *   }
 *
 * One-time pass: a backer can buy a single $9 "30-day pre-seed pass" on the
 * beginner Back me page after scanning the QR. That purchase has no recurring
 * subscription to flip the status when it lapses, so it is stored with
 * `oneTime: true` and a `currentPeriodEnd` (the 30-day expiry); it entitles
 * only until that moment. The row is granted by api/membership/claim.js when
 * the buyer first signs in (the pass is parked anonymously and claimed to their
 * account), not by the subscription webhook.
 */

"use strict";

const prisma = require("./db.js");

const MEMBERSHIP_KIND = "membership";
const PRESEED_TIER = "pre-seed";

// Marks a membership granted by a one-time pass rather than a subscription.
const ONE_TIME_SOURCE = "preseed-once";

// Stripe subscription statuses we treat as "the member can use paid features".
// `past_due` is intentionally included so a transient failed payment doesn't
// instantly lock someone out mid-cycle; Stripe flips it to `canceled`/`unpaid`
// once dunning is exhausted, and those do lock out.
const ACTIVE_STATUSES = Object.freeze(["active", "trialing", "past_due"]);

// The member paused billing on their own subscription. It's dormant, not gone:
// not entitling (so the paid surface locks while they aren't paying), but the
// subscription is preserved and one tap resumes it. Surfaced as our own status
// because Stripe keeps a paused subscription's `status` at "active".
const PAUSED_STATUS = "paused";

/** Pure: is this a one-time pass (vs. a subscription-backed membership)? */
function isOneTimePass(data) {
  return !!(data && data.oneTime);
}

/** Pure: a one-time pass entitles only until its 30-day window closes.
 *  `currentPeriodEnd` is the expiry, in Unix *seconds* (same field a
 *  subscription uses), so feature gates and the status endpoint read it the
 *  same way. `now` is injectable for tests. */
function isPassActive(data, now) {
  if (!isOneTimePass(data) || !data.tier) return false;
  const endMs = Number(data.currentPeriodEnd) * 1000;
  return Number.isFinite(endMs) && endMs > (now == null ? Date.now() : now);
}

/** Pure: does this stored membership blob entitle the user right now? */
function isActiveMembership(data, now) {
  if (!data || !data.tier) return false;
  // A one-time pass has no subscription to flip its status on lapse, so its
  // entitlement is purely the 30-day window — never the status string.
  if (isOneTimePass(data)) return isPassActive(data, now);
  return ACTIVE_STATUSES.includes(data.status);
}

/** Pure: is this member's subscription paused (dormant but resumable)? */
function isPausedMembership(data) {
  return !!(data && data.tier && !data.oneTime && data.status === PAUSED_STATUS);
}

async function readMembership(userId) {
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind: MEMBERSHIP_KIND } },
  });
  return row ? row.data : null;
}

async function hasActiveMembership(userId) {
  return isActiveMembership(await readMembership(userId));
}

async function writeMembership(userId, data) {
  return prisma.tinkerUserData.upsert({
    where: { userId_kind: { userId, kind: MEMBERSHIP_KIND } },
    create: { userId, kind: MEMBERSHIP_KIND, data },
    update: { data },
  });
}

module.exports = {
  MEMBERSHIP_KIND,
  PRESEED_TIER,
  ONE_TIME_SOURCE,
  ACTIVE_STATUSES,
  PAUSED_STATUS,
  isOneTimePass,
  isPassActive,
  isActiveMembership,
  isPausedMembership,
  readMembership,
  hasActiveMembership,
  writeMembership,
};
