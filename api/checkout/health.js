/* GET /api/checkout/health
 *
 * Diagnostic for the pre-seed checkout flow. Returns whether the
 * STRIPE_SECRET_KEY (or STRIPE_API_KEY) env var is present on this
 * deployment, and — if so — whether the payment link → price-id
 * lookup actually works. Never reveals the key itself; only its
 * existence.
 *
 * Use it after wiring the Stripe integration to confirm the function
 * runtime can actually see the secret:
 *
 *   curl https://<host>/api/checkout/health
 *
 * No auth required (the response carries no sensitive data).
 */

"use strict";

const stripe = require("../_lib/stripe.js");
const { withResponseLogging } = require("../_lib/log.js");

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const configured = stripe.isConfigured();
  if (!configured) {
    res.status(200).json({
      configured: false,
      priceDiscovered: false,
      message: "Set STRIPE_SECRET_KEY on the Vercel project (Production + Preview).",
    });
    return;
  }

  let priceId = null;
  let priceError = null;
  try {
    priceId = await stripe.discoverPreseedPriceId();
  } catch (err) {
    priceError = err.message || String(err);
  }

  res.status(200).json({
    configured: true,
    priceDiscovered: !!priceId,
    priceError,
  });
});
