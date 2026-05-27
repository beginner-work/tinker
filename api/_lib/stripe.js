/* Thin Stripe REST client for the pre-seed checkout flow.
 *
 * We use STRIPE_SECRET_KEY (provisioned on the tinker Vercel project,
 * Production + Preview) to:
 *
 *   1. Discover the recurring Price ID that the existing pre-seed
 *      Payment Link wraps (so we don't hardcode it, and so the same
 *      $8 / month price round-trips even if the link is rebuilt).
 *   2. Create a fresh Checkout Session per click, with our own
 *      success_url and the founder's Stytch user_id pinned as
 *      client_reference_id.
 *   3. Retrieve a session after the founder returns so we can flip
 *      the TinkerUserData row to active without trusting the browser.
 *
 * No SDK dep — Stripe's REST API takes Basic Auth on the secret key
 * and form-encoded bodies, both of which are tiny to do by hand.
 *
 * Caching: each warm Vercel lambda only looks up the Price ID once
 * (cached in module scope). Cold starts pay the lookup cost the
 * first time.
 */

"use strict";

const STRIPE_API = "https://api.stripe.com/v1";
// Same constant the renderer used to hardcode. Now the only place
// it lives is this file, so checkout/preseed.js doesn't need to
// know about it.
const PAYMENT_LINK_URL = "https://buy.stripe.com/bJe5kx8Owdx70nA9973F605";

function readSecret() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw Object.assign(
      new Error("Stripe is not configured on this deployment."),
      { status: 503 },
    );
  }
  return key;
}

function authHeader() {
  const auth = Buffer.from(`${readSecret()}:`).toString("base64");
  return `Basic ${auth}`;
}

async function stripeGet(path, query) {
  let url = STRIPE_API + path;
  if (query && Object.keys(query).length > 0) {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) usp.set(k, String(v));
    }
    url += `?${usp.toString()}`;
  }
  const res = await fetch(url, { headers: { Authorization: authHeader() } });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (payload && payload.error && (payload.error.message || payload.error.code)) ||
      `Stripe ${res.status}`;
    throw Object.assign(new Error(message), { status: res.status });
  }
  return payload || {};
}

async function stripePost(path, body) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(body || {})) {
    if (v !== undefined && v !== null) usp.set(k, String(v));
  }
  const res = await fetch(STRIPE_API + path, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: usp.toString(),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (payload && payload.error && (payload.error.message || payload.error.code)) ||
      `Stripe ${res.status}`;
    throw Object.assign(new Error(message), { status: res.status });
  }
  return payload || {};
}

// ── Price discovery ──────────────────────────────────────────────────
//
// The pre-seed payment link wraps a single recurring Price. We list
// payment links until we find the one whose `url` matches the
// hardcoded link above, then fetch its line_items to read the Price
// ID. Both calls are cached at module scope.

let cachedPriceId = null;

async function discoverPreseedPriceId() {
  if (cachedPriceId) return cachedPriceId;
  // Pagination: at most a handful of payment links per account, so
  // 100 covers it for every realistic case.
  const links = await stripeGet("/payment_links", { active: "true", limit: 100 });
  const match = (links.data || []).find((p) => p && p.url === PAYMENT_LINK_URL);
  if (!match) {
    throw Object.assign(
      new Error("Pre-seed payment link not found in this Stripe account."),
      { status: 500 },
    );
  }
  const lineItems = await stripeGet(`/payment_links/${match.id}/line_items`, { limit: 1 });
  const first = lineItems.data && lineItems.data[0];
  const priceId = first && first.price && first.price.id;
  if (!priceId) {
    throw Object.assign(
      new Error("Pre-seed payment link has no price."),
      { status: 500 },
    );
  }
  cachedPriceId = priceId;
  return priceId;
}

async function createCheckoutSession({ userId, successUrl, cancelUrl }) {
  const price = await discoverPreseedPriceId();
  const params = {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: successUrl,
    cancel_url: cancelUrl || successUrl.replace(/\?.*$/, ""),
    client_reference_id: userId,
    // Pinning the user_id into the subscription's metadata makes the
    // future customer.subscription.deleted webhook (handled by
    // api/stripe-webhook.js) able to look up the right row when
    // Stripe doesn't echo client_reference_id directly on the
    // subscription object.
    "subscription_data[metadata][client_reference_id]": userId,
    // Helps the founder if they ever look at the receipt in their
    // Stripe customer portal.
    "metadata[client_reference_id]": userId,
  };
  return stripePost("/checkout/sessions", params);
}

async function retrieveCheckoutSession(sessionId) {
  return stripeGet(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

module.exports = {
  PAYMENT_LINK_URL,
  discoverPreseedPriceId,
  createCheckoutSession,
  retrieveCheckoutSession,
  // Exposed for tests so they can stub the underlying HTTP calls.
  _internals: { stripeGet, stripePost },
};
