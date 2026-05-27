/* POST /api/checkout/verify
 *
 * Called by the renderer after Stripe redirects the founder back from
 * Checkout with `?stripe_session_id=cs_xxx` on the URL. Fetches the
 * Checkout Session from Stripe using STRIPE_SECRET_KEY (server-side
 * only — the browser never gets the secret) and:
 *
 *   1. Verifies session.payment_status === "paid" (or "no_payment_
 *      required" for the rare $0 case, which we don't actually use,
 *      but mirror Stripe's recommended check).
 *   2. Verifies session.client_reference_id matches the calling
 *      Stytch user_id — defends against a founder pasting somebody
 *      else's session id into their own URL.
 *   3. Upserts TinkerUserData{ kind: "subscription" } with the
 *      active blob, keyed to that user_id. Same row the future
 *      customer.subscription.deleted webhook flips back to inactive.
 *
 * Idempotent: calling this twice for the same session yields the
 * same row (the second upsert is a no-op apart from updatedAt).
 *
 * Request body:
 *   { "sessionId": "cs_..." }
 *
 * Auth: Stytch session token. Method: POST.
 *
 * Response: 200 { tier: "preseed", status: "active", activatedAt }
 */

"use strict";

const { resolveUserId } = require("../_lib/auth-user.js");
const { retrieveCheckoutSession } = require("../_lib/stripe.js");
const prisma = require("../_lib/db.js");
const { withResponseLogging } = require("../_lib/log.js");

const MAX_BODY_BYTES = 4 * 1024;

function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
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

  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || "Bad request" });
    return;
  }

  const sessionId = body && typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    res.status(400).json({ error: "Invalid sessionId" });
    return;
  }

  let session;
  try {
    session = await retrieveCheckoutSession(sessionId);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message || "Stripe error" });
    return;
  }

  if (!session || typeof session !== "object") {
    res.status(502).json({ error: "Stripe did not return a session" });
    return;
  }

  // Stripe marks an unpaid checkout (e.g. cancelled, expired) as
  // payment_status="unpaid". Only "paid" (or the $0 special case)
  // means the founder actually completed the purchase.
  const paid = session.payment_status === "paid"
    || session.payment_status === "no_payment_required";
  if (!paid) {
    res.status(402).json({ error: `Session is ${session.payment_status || "incomplete"}` });
    return;
  }

  if (session.client_reference_id !== userId) {
    // Mismatched session belongs to a different founder. Refuse —
    // we don't want a session id pasted from elsewhere to grant the
    // tier to the wrong account.
    res.status(403).json({ error: "Session does not belong to this user" });
    return;
  }

  const activatedAt = Date.now();
  const data = {
    tier: "preseed",
    status: "active",
    activatedAt,
    source: "checkout-verify",
    stripeRef: session.id,
    subscriptionId: session.subscription || null,
  };
  await prisma.tinkerUserData.upsert({
    where: { userId_kind: { userId, kind: "subscription" } },
    create: { userId, kind: "subscription", data },
    update: { data },
  });

  res.status(200).json({
    tier: "preseed",
    status: "active",
    activatedAt,
  });
});
