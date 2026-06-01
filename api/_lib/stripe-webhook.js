/* Stripe webhook verification + event → membership mapping.
 *
 * Both functions are pure and synchronous so they can be unit-tested without
 * the Stripe SDK or the network. `constructEvent` reimplements Stripe's
 * signature scheme (HMAC-SHA256 over "<t>.<rawBody>", compared in constant
 * time, with a timestamp tolerance) so we keep api/ dependency-free.
 */

"use strict";

const crypto = require("crypto");
const { PRESEED_TIER } = require("./membership.js");
const { subscriptionPeriodEnd } = require("./stripe-reconcile.js");

function err(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Parse a `Stripe-Signature` header: "t=123,v1=abc,v1=def". */
function parseSignatureHeader(header) {
  const out = { t: "", v1: [] };
  if (!header || typeof header !== "string") return out;
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") out.t = v;
    else if (k === "v1") out.v1.push(v);
  }
  return out;
}

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Verify the signature and return the parsed event. Throws (with .status) on
 * any failure. `opts.nowSec` / `opts.toleranceSec` are injectable for tests.
 */
function constructEvent(rawBody, signatureHeader, secret, opts = {}) {
  if (!secret) throw err(500, "Webhook secret not configured");
  const tolerance = opts.toleranceSec == null ? 300 : opts.toleranceSec;
  const now = opts.nowSec == null ? Math.floor(Date.now() / 1000) : opts.nowSec;

  const { t, v1 } = parseSignatureHeader(signatureHeader);
  if (!t || v1.length === 0) throw err(400, "Missing or malformed signature");

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${rawBody}`, "utf8")
    .digest("hex");
  if (!v1.some((sig) => timingSafeEqual(sig, expected))) {
    throw err(400, "Signature verification failed");
  }
  if (Math.abs(now - Number(t)) > tolerance) {
    throw err(400, "Timestamp outside tolerance");
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw err(400, "Invalid JSON payload");
  }
}

/** Drop null/undefined keys so we don't persist noise. */
function clean(obj) {
  const out = {};
  for (const k of Object.keys(obj)) {
    if (obj[k] !== null && obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/**
 * Map a verified Stripe event to a membership write, or null if the event
 * isn't one we act on. Returns { userId, data } where data is the blob to
 * store under kind="membership".
 */
function membershipFromEvent(event) {
  if (!event || !event.type || !event.data || !event.data.object) return null;
  const obj = event.data.object;

  switch (event.type) {
    case "checkout.session.completed": {
      if (obj.mode !== "subscription") return null;
      const userId = obj.client_reference_id || (obj.metadata && obj.metadata.userId) || "";
      if (!userId) return null;
      // Only grant once Stripe confirms the session is paid.
      if (
        obj.payment_status &&
        obj.payment_status !== "paid" &&
        obj.payment_status !== "no_payment_required"
      ) {
        return null;
      }
      return {
        userId,
        data: clean({
          tier: PRESEED_TIER,
          status: "active",
          stripeCustomerId: obj.customer || null,
          stripeSubscriptionId: obj.subscription || null,
        }),
      };
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const userId = (obj.metadata && obj.metadata.userId) || "";
      if (!userId) return null;
      const status =
        event.type === "customer.subscription.deleted" ? "canceled" : obj.status || "canceled";
      return {
        userId,
        data: clean({
          tier: PRESEED_TIER,
          status,
          stripeCustomerId: obj.customer || null,
          stripeSubscriptionId: obj.id || null,
          // Period end moved onto the subscription item in recent Stripe API
          // versions; subscriptionPeriodEnd reads whichever the payload uses.
          currentPeriodEnd: subscriptionPeriodEnd(obj),
        }),
      };
    }

    default:
      return null;
  }
}

module.exports = { constructEvent, membershipFromEvent, parseSignatureHeader };
