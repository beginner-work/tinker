/* POST /api/checkout/preseed
 *
 * Mints a fresh Stripe Checkout Session for the pre-seed ($8 / month)
 * tier and returns its hosted URL. The session is configured so that:
 *
 *   - mode = "subscription" with the same recurring price the
 *     existing pre-seed Payment Link wraps (discovered server-side in
 *     api/_lib/stripe.js — never hardcoded here).
 *   - client_reference_id = the founder's Stytch user_id, so the
 *     subsequent /api/checkout/verify call can prove ownership of the
 *     session before flipping their TinkerUserData row to active.
 *   - success_url = the Origin that made the request, with
 *     `?stripe_session_id={CHECKOUT_SESSION_ID}` appended so the
 *     renderer can hand the session id back to /api/checkout/verify.
 *
 * Doing the URL build server-side keeps the user_id out of the
 * browser (the client only holds the opaque Stytch session_token; the
 * user_id lives behind authenticateSession) and lets us discover the
 * Price ID dynamically.
 *
 * Auth: Stytch session token. Method: POST (no body).
 *
 * Response: 200 { url }
 */

"use strict";

const { resolveUserId } = require("../_lib/auth-user.js");
const { createCheckoutSession } = require("../_lib/stripe.js");
const { withResponseLogging } = require("../_lib/log.js");

function resolveOrigin(req) {
  // Vercel sets these. Prefer the explicit forwarded origin so a
  // preview deploy bounces back to itself rather than to production.
  const headers = req.headers || {};
  const proto = (headers["x-forwarded-proto"] || "https").toString().split(",")[0].trim();
  const host = (headers["x-forwarded-host"] || headers.host || "").toString().split(",")[0].trim();
  if (!host) return null;
  return `${proto}://${host}`;
}

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

  const origin = resolveOrigin(req);
  if (!origin) {
    res.status(500).json({ error: "Could not resolve request origin" });
    return;
  }

  // {CHECKOUT_SESSION_ID} is Stripe's literal template placeholder —
  // Stripe substitutes the real session id on redirect.
  const successUrl = `${origin}/?stripe_session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${origin}/`;

  let session;
  try {
    session = await createCheckoutSession({ userId, successUrl, cancelUrl });
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || "Stripe error" });
    return;
  }

  if (!session || typeof session.url !== "string") {
    res.status(502).json({ error: "Stripe did not return a session URL" });
    return;
  }

  res.status(200).json({ url: session.url });
});
