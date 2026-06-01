/* POST /api/stripe/webhook — receive Stripe subscription events and record
 * pre-seed membership entitlement against the buyer's tinker user_id.
 *
 * The raw request body is required for signature verification, so we read the
 * stream ourselves rather than trusting a parsed body. Events we don't act on
 * are acknowledged with 200 so Stripe stops retrying them.
 *
 * Config (Vercel env):
 *   STRIPE_WEBHOOK_SECRET  required — the signing secret for this endpoint.
 */

"use strict";

const { withResponseLogging } = require("../_lib/log.js");
const { constructEvent, membershipFromEvent } = require("../_lib/stripe-webhook.js");
const { writeMembership } = require("../_lib/membership.js");

const MAX_BYTES = 1024 * 1024; // 1 MB — Stripe events are small.

function readRawBody(req) {
  if (typeof req.body === "string") return Promise.resolve(req.body);
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString("utf8"));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    res.status(503).json({ error: "Webhook not configured." });
    return;
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || "Bad body" });
    return;
  }

  let event;
  try {
    event = constructEvent(raw, req.headers["stripe-signature"], secret);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || "Bad signature" });
    return;
  }

  try {
    const membership = membershipFromEvent(event);
    if (membership && membership.userId) {
      await writeMembership(membership.userId, membership.data);
    }
    res.status(200).json({ received: true });
  } catch {
    // Surface a 500 so Stripe retries — a transient DB error shouldn't drop
    // the entitlement on the floor.
    res.status(500).json({ error: "Webhook processing failed" });
  }
});
