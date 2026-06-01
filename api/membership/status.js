/* GET /api/membership/status — does the signed-in user have an active
 * pre-seed membership? The tinker client calls this to unlock paid surfaces
 * (viewing other founders' pitches/essays, creating a profile).
 *
 * The entitlement row is normally written by the Stripe webhook, but a
 * subscription bought outside tinker's own checkout (e.g. the beginner "Back
 * me" page) carries no tinker user_id for the webhook to key on, so the buyer
 * would see "Free plan" despite paying. Before reporting free, we therefore
 * make a best-effort, throttled attempt to bridge such a subscription by the
 * account email (api/_lib/membership-reconcile.js) — the same match the manual
 * "Restore" action uses, just automatic so the member doesn't have to find it.
 */

"use strict";

const { withResponseLogging } = require("../_lib/log.js");
const { resolveUserId } = require("../_lib/user-data.js");
const { readMembership, isActiveMembership } = require("../_lib/membership.js");
const { autoReconcileForStatus } = require("../_lib/membership-reconcile.js");

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Per-user entitlement, and it flips the moment a member subscribes or
  // restores — never let a browser/CDN serve a stale "Free plan" read back to a
  // member who just paid (which is what a cached response would do right after
  // a restore re-pulls this endpoint).
  res.setHeader("Cache-Control", "no-store");

  let userId;
  try {
    userId = await resolveUserId(req);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  try {
    let data = await readMembership(userId);
    // Not entitled on file? The member may have paid outside tinker's checkout.
    // Try to link it by email before we report "Free plan" (best-effort).
    if (!isActiveMembership(data)) {
      data = await autoReconcileForStatus(userId, data, process.env.STRIPE_SECRET_KEY);
    }
    res.status(200).json({
      active: isActiveMembership(data),
      tier: (data && data.tier) || null,
      status: (data && data.status) || null,
      currentPeriodEnd: (data && data.currentPeriodEnd) || null,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "Internal error" });
  }
});
