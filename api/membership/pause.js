/* POST /api/membership/pause — pause (or resume) the signed-in member's
 * pre-seed subscription.
 *
 * Body: { resume?: boolean }
 *   resume omitted/false → pause billing (Stripe `pause_collection`).
 *   resume: true         → clear the pause and bill normally again.
 *
 * Pausing keeps the subscription alive but stops charging the member until
 * they come back, instead of canceling and forcing a fresh checkout later. We
 * resolve the subscription from the entitlement row the webhook/checkout wrote
 * (api/_lib/membership.js), flip `pause_collection` on it via Stripe's REST API
 * over fetch — no SDK, matching the rest of api/ — then write the returned
 * subscription's state straight back so the sidebar flips immediately without
 * waiting on the webhook round-trip. The webhook later confirms the same thing.
 *
 * Config (Vercel env): STRIPE_SECRET_KEY (shared with membership/checkout).
 */

"use strict";

const { withResponseLogging } = require("../_lib/log.js");
const { resolveUserId, readJsonBody } = require("../_lib/user-data.js");
const {
  readMembership,
  writeMembership,
  isActiveMembership,
  isPausedMembership,
} = require("../_lib/membership.js");
const { membershipFromSubscription } = require("../_lib/stripe-reconcile.js");
const { buildPauseParams } = require("../_lib/stripe-pause.js");

const STRIPE_API = "https://api.stripe.com/v1/subscriptions";

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Never let a CDN serve a stale plan back after the member pauses/resumes.
  res.setHeader("Cache-Control", "no-store");

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    res.status(503).json({ error: "Pausing isn't available right now." });
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
  const resume = !!(body && body.resume);

  // We can only pause a subscription we know about. The entitlement row carries
  // the Stripe subscription id (written by checkout's webhook or a restore).
  const data = await readMembership(userId);
  const subscriptionId = data && data.stripeSubscriptionId;
  if (!subscriptionId) {
    res.status(409).json({ error: "No subscription to pause." });
    return;
  }

  // Guard against no-op flips so the button can't, e.g., "resume" a live plan
  // or "pause" an already-paused one and report a confusing success.
  if (resume && !isPausedMembership(data)) {
    res.status(409).json({ error: "Your membership isn't paused." });
    return;
  }
  if (!resume && !isActiveMembership(data)) {
    res.status(409).json({ error: "Only an active membership can be paused." });
    return;
  }

  let response;
  let sub;
  try {
    response = await fetch(`${STRIPE_API}/${encodeURIComponent(subscriptionId)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: buildPauseParams({ resume }).toString(),
    });
    sub = await response.json();
  } catch {
    res.status(502).json({ error: "Couldn't reach the payment provider." });
    return;
  }

  if (!response.ok || !sub || !sub.id) {
    const message = (sub && sub.error && sub.error.message) || "Couldn't update your membership.";
    res.status(502).json({ error: message });
    return;
  }

  // Persist the fresh state from Stripe's response (the source of truth for the
  // just-applied change) so the sidebar flips now; the webhook re-confirms it.
  const next = membershipFromSubscription(sub);
  try {
    await writeMembership(userId, next);
  } catch {
    res.status(500).json({ error: "Couldn't save your membership. Try again." });
    return;
  }

  res.status(200).json({
    paused: isPausedMembership(next),
    active: isActiveMembership(next),
    tier: next.tier,
    status: next.status,
    currentPeriodEnd: next.currentPeriodEnd || null,
  });
});
