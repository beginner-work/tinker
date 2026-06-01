/* Build the Stripe Checkout Session params for the pre-seed membership.
 *
 * Pure (no I/O) so it's unit-testable; the handler in
 * api/membership/checkout.js POSTs the result to Stripe over fetch — no SDK,
 * matching the zero-dependency style of the rest of api/.
 *
 * The defining difference from beginner's anonymous checkout: the buyer is a
 * signed-in tinker user, so we stamp their Stytch user_id onto the session
 * (client_reference_id + metadata) AND onto the resulting subscription
 * (subscription_data[metadata]). That second stamp is what later
 * customer.subscription.updated/deleted webhooks — which only carry the
 * subscription, not the session — use to resolve the member.
 *
 * Config (Vercel env):
 *   STRIPE_PRICE_PRESEED  optional — a recurring $9/month Price id. If unset
 *                         we build the price inline so the flow works without
 *                         any dashboard setup.
 */

"use strict";

const PRESEED_AMOUNT_CENTS = 900; // $9.00 / month

/** A same-site path to return to after checkout. Defaults to the tinker root.
 *  Anything that isn't a clean local path is ignored — never off-site. */
function safeReturnPath(raw) {
  if (typeof raw === "string" && /^\/[A-Za-z0-9._~\-/]*$/.test(raw)) {
    return raw.replace(/\/+$/, "") || "/";
  }
  return "/";
}

function buildCheckoutParams({ userId, origin, returnPath }) {
  if (!userId) throw Object.assign(new Error("userId required"), { status: 401 });

  const params = new URLSearchParams();
  params.append("mode", "subscription");
  params.append("billing_address_collection", "auto");
  params.append("allow_promotion_codes", "true");
  // Identity: who this checkout belongs to.
  params.append("client_reference_id", userId);
  params.append("metadata[userId]", userId);
  // Propagate identity onto the subscription so renewal/cancel webhooks resolve.
  params.append("subscription_data[metadata][userId]", userId);

  params.append("line_items[0][quantity]", "1");
  const priceId = process.env.STRIPE_PRICE_PRESEED;
  if (priceId) {
    params.append("line_items[0][price]", priceId);
  } else {
    params.append("line_items[0][price_data][currency]", "usd");
    params.append("line_items[0][price_data][unit_amount]", String(PRESEED_AMOUNT_CENTS));
    params.append("line_items[0][price_data][recurring][interval]", "month");
    params.append("line_items[0][price_data][product_data][name]", "beginner — pre-seed");
    params.append(
      "line_items[0][price_data][product_data][description]",
      "Pre-seed membership: follow founders, support their essays, and create your profile."
    );
  }

  const base = origin || "";
  const path = safeReturnPath(returnPath);
  params.append("success_url", `${base}${path}?status=success`);
  params.append("cancel_url", `${base}${path}?status=cancelled`);
  return params;
}

module.exports = { buildCheckoutParams, safeReturnPath, PRESEED_AMOUNT_CENTS };
