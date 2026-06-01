/* POST /api/membership/checkout — open a Stripe Checkout session for the
 * pre-seed ($9/month) membership, for the signed-in tinker user.
 *
 * Because the buyer is authenticated here (unlike beginner's anonymous
 * checkout), we stamp their Stytch user_id onto the session and subscription
 * so the webhook can record entitlement against the right identity.
 *
 * We talk to Stripe over its REST API with fetch — no SDK — keeping this a
 * zero-dependency serverless function. When STRIPE_SECRET_KEY is missing we
 * return 503 so a preview/dev deploy degrades gracefully.
 */

"use strict";

const { withResponseLogging } = require("../_lib/log.js");
const { resolveUserId, readJsonBody } = require("../_lib/user-data.js");
const { buildCheckoutParams } = require("../_lib/stripe-checkout.js");

const STRIPE_API = "https://api.stripe.com/v1/checkout/sessions";

/** Best-effort absolute origin for success/cancel redirects. */
function originFromRequest(req, body) {
  if (body && typeof body.origin === "string" && /^https?:\/\//.test(body.origin)) {
    return body.origin.replace(/\/+$/, "");
  }
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (!host) return "";
  const proto =
    req.headers["x-forwarded-proto"] ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${proto}://${host}`;
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    res.status(503).json({ error: "Checkout isn't available right now." });
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

  const origin = originFromRequest(req, body);
  const params = buildCheckoutParams({ userId, origin, returnPath: body && body.returnPath });

  let response;
  let session;
  try {
    response = await fetch(STRIPE_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    session = await response.json();
  } catch {
    res.status(502).json({ error: "Couldn't reach the payment provider." });
    return;
  }

  if (!response.ok || !session || !session.url) {
    const message =
      (session && session.error && session.error.message) || "Couldn't start checkout.";
    res.status(502).json({ error: message });
    return;
  }

  res.status(200).json({ url: session.url });
});
