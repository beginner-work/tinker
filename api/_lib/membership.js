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
 */

"use strict";

const prisma = require("./db.js");

const MEMBERSHIP_KIND = "membership";
const PRESEED_TIER = "pre-seed";

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

/** Pure: does this stored membership blob entitle the user right now? */
function isActiveMembership(data) {
  return !!(data && data.tier && ACTIVE_STATUSES.includes(data.status));
}

/** Pure: is this member's subscription paused (dormant but resumable)? */
function isPausedMembership(data) {
  return !!(data && data.tier && data.status === PAUSED_STATUS);
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
  ACTIVE_STATUSES,
  PAUSED_STATUS,
  isActiveMembership,
  isPausedMembership,
  readMembership,
  hasActiveMembership,
  writeMembership,
};
