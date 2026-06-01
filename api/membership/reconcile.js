/* POST /api/membership/reconcile — link an already-paid pre-seed subscription
 * to the signed-in tinker user.
 *
 * Why this exists: tinker's entitlement row (api/_lib/membership.js) is only
 * written by the Stripe webhook, and only when the buyer's tinker user_id was
 * stamped on the Checkout Session / subscription (api/_lib/stripe-checkout.js).
 * A subscription started *outside* tinker's own checkout — from the beginner
 * "Back me" page, a Payment Link, or the Stripe dashboard — carries no tinker
 * user_id, so the webhook has nothing to key it to and the member sees "Free
 * plan" despite paying. This endpoint closes that gap: the signed-in user
 * reconciles by the email on their account (or one they supply), and if Stripe
 * shows an active subscription for it we write the entitlement against *their*
 * tinker user_id.
 *
 * Matching is by email — the account (profile) email is preferred, with a
 * caller-supplied email as a fallback for accounts that never set one. NOTE:
 * tinker verifies phone, not email, so the email here is not independently
 * proven to belong to the caller. The unlocked surface is low-value (reading
 * other founders' pitches, creating a profile), so this is acceptable for
 * launch; harden with an email-OTP step before promoting it widely.
 *
 * Config (Vercel env): STRIPE_SECRET_KEY (shared with membership/checkout).
 */

"use strict";

const { withResponseLogging } = require("../_lib/log.js");
const { resolveUserId, readJsonBody } = require("../_lib/user-data.js");
const { writeMembership, isActiveMembership } = require("../_lib/membership.js");
const { normalizeEmail, pickMembershipFromSubscriptions } = require("../_lib/stripe-reconcile.js");
const { profileEmail, subscriptionsForEmail } = require("../_lib/membership-reconcile.js");

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    res.status(503).json({ error: "Reconciliation isn't available right now." });
    return;
  }

  let userId;
  try {
    userId = await resolveUserId(req);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    body = {};
  }

  const email = normalizeEmail(body && body.email) || (await profileEmail(userId));
  if (!email) {
    res.status(200).json({ restored: false, reason: "no-email" });
    return;
  }

  let data;
  try {
    const subs = await subscriptionsForEmail(email, secretKey);
    data = pickMembershipFromSubscriptions(subs);
  } catch (err) {
    res
      .status(err.status || 502)
      .json({ error: err.message || "Couldn't reach the payment provider." });
    return;
  }

  if (!data) {
    res.status(200).json({ restored: false, reason: "no-subscription" });
    return;
  }

  try {
    await writeMembership(userId, data);
  } catch {
    res.status(500).json({ error: "Couldn't save your membership. Try again." });
    return;
  }

  res.status(200).json({
    restored: true,
    active: isActiveMembership(data),
    tier: data.tier,
    status: data.status,
    currentPeriodEnd: data.currentPeriodEnd || null,
  });
});
