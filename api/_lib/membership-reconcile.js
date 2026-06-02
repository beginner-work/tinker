/* I/O for reconciling an already-paid Stripe subscription to a tinker user.
 *
 * The pure shape-mapping lives in api/_lib/stripe-reconcile.js; this module is
 * the side-effecting half (Stripe over fetch, the profile row, the entitlement
 * write). It's shared by two callers:
 *
 *   - api/membership/reconcile.js  — the explicit "Already subscribed? Restore"
 *     action, which can also prompt for an email.
 *   - api/membership/status.js     — a best-effort *automatic* reconcile on
 *     read, so a member who paid outside tinker's checkout (no tinker user_id
 *     on the Stripe subscription for the webhook to key on) stops seeing "Free
 *     plan" without having to discover the restore link.
 *
 * Same trust model as reconcile.js: matching is by email, which tinker doesn't
 * independently verify (it verifies phone). The unlocked surface is low-value,
 * so this is acceptable for launch; harden with an email-OTP step before
 * promoting it widely.
 */

"use strict";

const prisma = require("./db.js");
const { isActiveMembership, isPausedMembership, writeMembership } = require("./membership.js");
const { normalizeEmail, pickMembershipFromSubscriptions } = require("./stripe-reconcile.js");

const STRIPE_API = "https://api.stripe.com";

// Genuinely-free accounts (an email on file but no subscription) would
// otherwise re-hit Stripe on every status read. Once we've looked and found
// nothing we stamp the membership row with `checkedAt` and skip the lookup for
// this long. Currently-stuck members carry no stamp, so they're recognized on
// their very next load regardless; this only bounds the *repeat* probes.
const RECONCILE_COOLDOWN_SEC = 6 * 60 * 60; // 6 hours

async function stripeGet(path, secretKey) {
  const res = await fetch(STRIPE_API + path, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    const message = (json && json.error && json.error.message) || `Stripe ${res.status}`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  return json;
}

/** The email on the user's tinker profile, if any. */
async function profileEmail(userId) {
  try {
    const row = await prisma.tinkerUserData.findUnique({
      where: { userId_kind: { userId, kind: "profile" } },
    });
    return normalizeEmail(row && row.data && row.data.email);
  } catch {
    return "";
  }
}

/** Every subscription tied to any Stripe customer with this email. */
async function subscriptionsForEmail(email, secretKey) {
  const customers = await stripeGet(
    `/v1/customers?email=${encodeURIComponent(email)}&limit=20`,
    secretKey
  );
  const list = (customers && customers.data) || [];
  const subs = [];
  for (const cust of list) {
    if (!cust || !cust.id) continue;
    const r = await stripeGet(
      `/v1/subscriptions?customer=${encodeURIComponent(cust.id)}&status=all&limit=20`,
      secretKey
    );
    for (const s of (r && r.data) || []) subs.push(s);
  }
  return subs;
}

/**
 * Find an entitling subscription for `email` and persist it against `userId`.
 * Returns the stored membership blob, or null when nothing entitles. Throws
 * (with .status) on a Stripe failure.
 */
async function reconcileByEmail(userId, email, secretKey) {
  const e = normalizeEmail(email);
  if (!e) return null;
  const subs = await subscriptionsForEmail(e, secretKey);
  const data = pickMembershipFromSubscriptions(subs);
  if (!data) return null;
  await writeMembership(userId, data);
  return data;
}

/**
 * Pure: should a status read attempt a fresh Stripe reconcile for this stored
 * membership blob? No when already entitled, and no when we looked recently
 * (cooldown). `nowSec` is injected so this stays unit-testable.
 */
function shouldAutoReconcile(data, nowSec) {
  if (isActiveMembership(data)) return false;
  // A row we already know is paused is the correct answer — bridging exists to
  // recover MISSING entitlement, not to re-confirm a known-dormant subscription
  // on every status read.
  if (isPausedMembership(data)) return false;
  if (
    data &&
    typeof data.checkedAt === "number" &&
    nowSec - data.checkedAt < RECONCILE_COOLDOWN_SEC
  ) {
    return false;
  }
  return true;
}

/**
 * Best-effort entitlement self-heal for GET /api/membership/status: when the
 * user isn't entitled yet, try to bridge a subscription bought outside
 * tinker's checkout by their account email. Returns the membership blob to
 * report — the freshly-reconciled one, the input unchanged, or the input
 * stamped with `checkedAt` so we don't re-probe Stripe every load.
 */
async function autoReconcileForStatus(userId, data, secretKey, now) {
  if (!secretKey) return data;
  const nowSec = typeof now === "number" ? now : Math.floor(Date.now() / 1000);
  if (!shouldAutoReconcile(data, nowSec)) return data;

  const email = await profileEmail(userId);
  if (!email) return data; // phone-only account: nothing to match on

  try {
    const reconciled = await reconcileByEmail(userId, email, secretKey);
    if (reconciled) return reconciled;
  } catch {
    // Stripe hiccup — leave the row untouched so the next load retries.
    return data;
  }

  // Looked and found nothing: remember it so we throttle the next probe.
  const stamped = Object.assign({}, data, { checkedAt: nowSec });
  try {
    await writeMembership(userId, stamped);
  } catch {
    /* best-effort */
  }
  return stamped;
}

module.exports = {
  RECONCILE_COOLDOWN_SEC,
  stripeGet,
  profileEmail,
  subscriptionsForEmail,
  reconcileByEmail,
  shouldAutoReconcile,
  autoReconcileForStatus,
};
