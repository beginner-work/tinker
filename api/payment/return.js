/* GET /api/payment/return?session_id=cs_...
 *
 * Stripe Checkout redirects here on success. We verify the session with
 * the Stripe API and then redirect to `/?paid=1`, where the renderer
 * picks up the query param, refreshes window.tinkerAuth.isSubscribed(),
 * and clears the query string.
 *
 * The webhook is the source of truth for the subscription record; this
 * endpoint just hands the user back to the app with a hint that payment
 * succeeded.
 */

"use strict";

const { withResponseLogging } = require("../_lib/log.js");

async function verifyCheckoutSession({ secretKey, sessionId }) {
  if (!sessionId) return null;
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { "Authorization": `Bearer ${secretKey}` },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).send("Method not allowed");
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const sessionId = (req.query && req.query.session_id) || "";

  let paid = "0";
  if (secretKey && sessionId) {
    const session = await verifyCheckoutSession({ secretKey, sessionId });
    if (session && (session.payment_status === "paid" || session.status === "complete")) {
      paid = "1";
    }
  }

  // Return a tiny HTML page that redirects to /?paid=1. Using an HTML
  // redirect (rather than a 302) so the in-browser session state
  // (localStorage etc.) follows through the bounce cleanly.
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><title>tinker</title>` +
    `<meta http-equiv="refresh" content="0; url=/?paid=${encodeURIComponent(paid)}">` +
    `</head><body><script>location.replace("/?paid=${encodeURIComponent(paid)}")</script></body></html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
});
