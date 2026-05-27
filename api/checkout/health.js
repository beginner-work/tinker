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

// Return only the *names* of env vars whose name suggests Stripe.
// Never returns values. Used to disambiguate "the integration set it
// under an unexpected name" from "the integration didn't touch this
// project at all".
function stripeEnvNames() {
  const out = [];
  for (const name of Object.keys(process.env)) {
    if (/stripe/i.test(name)) out.push(name);
  }
  return out.sort();
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const configured = stripe.isConfigured();
  const envNames = stripeEnvNames();

  if (!configured) {
    res.status(200).json({
      configured: false,
      priceDiscovered: false,
      envNamesSeen: envNames,
      message: envNames.length === 0
        ? "No STRIPE_* env vars are present on the tinker Vercel project's function runtime. Set STRIPE_SECRET_KEY (Production + Preview) and redeploy."
        : `Found env vars [${envNames.join(", ")}] but none named STRIPE_SECRET_KEY or STRIPE_API_KEY. Rename one of them or add STRIPE_SECRET_KEY.`,
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
    envNamesSeen: envNames,
  });
});
