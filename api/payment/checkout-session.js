/* POST /api/payment/checkout-session
 *
 * Authorization: Bearer <stytch session_token>
 * Reply: { url }
 *
 * Creates a Stripe Checkout session for the $8/mo sharpening subscription
 * and returns the redirect URL. Apple Pay is enabled at the Stripe
 * dashboard level — the session itself just declares `card`, and Stripe
 * surfaces Apple Pay when the device supports it.
 *
 * Env vars required:
 *   - STRIPE_SECRET_KEY  — Stripe restricted key (subscriptions + checkout)
 *   - STRIPE_PRICE_ID    — recurring $8/mo price ID; [NEEDS INPUT] before launch
 *   - APP_BASE_URL       — the absolute URL of the deployment, e.g.
 *                          https://tinker.beginner.work. Used for the
 *                          success_url / cancel_url. Falls back to
 *                          VERCEL_URL with https:// prefix if unset.
 */

"use strict";

const { authenticateSession } = require("../_lib/stytch.js");
const { withResponseLogging } = require("../_lib/log.js");

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function baseUrl() {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function resolveSessionUser(token) {
  const session = await authenticateSession(token);
  const userId =
    (session && session.session && session.session.user_id) ||
    (session && session.user && session.user.user_id) ||
    "";
  if (!userId) {
    throw Object.assign(new Error("Session missing user id"), { status: 401 });
  }
  const phoneNumber =
    (session && session.user && Array.isArray(session.user.phone_numbers) && session.user.phone_numbers[0] && session.user.phone_numbers[0].phone_number) ||
    "";
  const email =
    (session && session.user && Array.isArray(session.user.emails) && session.user.emails[0] && session.user.emails[0].email) ||
    "";
  return { userId, phoneNumber, email };
}

async function createCheckoutSession({ secretKey, priceId, userId, customerEmail, successUrl, cancelUrl }) {
  // Stripe accepts urlencoded bodies for the REST API. We build it by
  // hand to avoid pulling in the Stripe SDK.
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("line_items[0][price]", priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("payment_method_types[0]", "card");
  params.set("client_reference_id", userId);
  if (customerEmail) params.set("customer_email", customerEmail);
  params.set("success_url", successUrl);
  params.set("cancel_url", cancelUrl);
  // Allow promo codes via the Stripe-hosted screen.
  params.set("allow_promotion_codes", "true");
  // Stamp the tinker user id onto the subscription itself so the
  // webhook can look up the right user on subscription.updated /
  // subscription.deleted events (those events don't carry
  // client_reference_id).
  params.set("subscription_data[metadata][tinker_user_id]", userId);
  params.set("metadata[tinker_user_id]", userId);

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data && data.error && data.error.message) || `Stripe ${res.status}`;
    throw Object.assign(new Error(message), { status: 502 });
  }
  return data;
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!secretKey || !priceId) {
    res.status(503).json({ error: "Stripe is not configured on this deployment." });
    return;
  }

  const token = extractBearer(req.headers && req.headers.authorization);
  let user;
  try {
    user = await resolveSessionUser(token);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  const root = baseUrl();
  const successUrl = `${root}/api/payment/return?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${root}/?paid=0`;

  try {
    const session = await createCheckoutSession({
      secretKey,
      priceId,
      userId: user.userId,
      customerEmail: user.email || undefined,
      successUrl,
      cancelUrl,
    });
    if (!session || !session.url) {
      res.status(502).json({ error: "Stripe response missing url" });
      return;
    }
    res.status(200).json({ url: session.url });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || "Upstream error" });
  }
});
