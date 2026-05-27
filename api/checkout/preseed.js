/* POST /api/checkout/preseed
 *
 * Returns the Stripe payment-link URL for the pre-seed ($8 / month)
 * tier, with the calling founder's Stytch user_id appended as
 * `client_reference_id`. Stripe echoes that field back on the
 * checkout.session.completed webhook, which is how /api/stripe-webhook
 * decides which TinkerUserData row to flip to `active`.
 *
 * Doing the URL build server-side keeps the user_id out of the browser
 * (the client only holds the opaque Stytch session_token; the user_id
 * lives behind authenticateSession). The payment link itself is the
 * same constant used in src/renderer/subscription.js.
 *
 * Auth: Stytch session token. Method: POST (no body).
 *
 * Response: 200 { url }
 */

"use strict";

const { resolveUserId } = require("../_lib/auth-user.js");
const { withResponseLogging } = require("../_lib/log.js");

const PAYMENT_LINK = "https://buy.stripe.com/bJe5kx8Owdx70nA9973F605";

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let userId;
  try {
    userId = await resolveUserId(req);
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
    return;
  }

  // Stripe Payment Links accept client_reference_id as a query param
  // and round-trip it on the webhook's session.client_reference_id.
  // https://docs.stripe.com/payment-links/url-parameters
  const url = `${PAYMENT_LINK}?client_reference_id=${encodeURIComponent(userId)}`;
  res.status(200).json({ url });
});
