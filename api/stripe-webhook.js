/* POST /api/stripe-webhook
 *
 * Authoritative writer for the founder's paid tier. Subscribes to
 * Stripe's checkout.session.completed event; when it fires for a
 * session whose `client_reference_id` is a Stytch user_id we minted
 * at /api/checkout/preseed, upserts the TinkerUserData row
 * (userId, kind="subscription") with the active blob. Also handles
 * customer.subscription.deleted so a cancelled subscription flips
 * the row back to inactive.
 *
 * The renderer (src/renderer/subscription.js) GETs the row via
 * /api/user-data/subscription on boot and on tab visibility — there
 * is no client trust path. localStorage on the renderer is just a
 * synchronous cache for the sidebar.
 *
 * Setup (one-time, in the Stripe Dashboard):
 *
 *   1. Add a webhook endpoint pointing at
 *      https://<host>/api/stripe-webhook
 *   2. Subscribe it to checkout.session.completed and
 *      customer.subscription.deleted.
 *   3. Copy the signing secret (starts with `whsec_`) into the
 *      Vercel env var STRIPE_WEBHOOK_SECRET on the tinker project,
 *      for both Production and Preview.
 *
 * No Stripe SDK dep — signature verification is HMAC-SHA256 against
 * `<t>.<rawBody>`, the same scheme `stripe.webhooks.constructEvent`
 * implements internally.
 *
 * Raw body: Stripe's signature is computed over the exact bytes it
 * sent, so we disable Vercel's JSON auto-parsing (the bodyParser
 * config at the bottom of this file) and read the request stream
 * ourselves.
 */

"use strict";

const crypto = require("crypto");
const prisma = require("./_lib/db.js");
const { withResponseLogging } = require("./_lib/log.js");

// Stripe's spec: tolerate a 5-minute clock skew between Stripe and
// our server. Anything older is rejected as a possible replay.
const SIGNATURE_TOLERANCE_SECONDS = 300;
const MAX_BYTES = 1024 * 1024;

async function readRawBody(req) {
  // If Vercel already buffered the body, surface it as-is.
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "utf8");
  // Otherwise read the stream.
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
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseSignatureHeader(header) {
  const out = { t: null, v1: [] };
  if (!header || typeof header !== "string") return out;
  for (const part of header.split(",")) {
    const [key, value] = part.split("=");
    if (!key || !value) continue;
    const k = key.trim();
    const v = value.trim();
    if (k === "t") out.t = Number(v);
    else if (k === "v1") out.v1.push(v);
  }
  return out;
}

function constantTimeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifySignature(rawBody, header, secret) {
  const parsed = parseSignatureHeader(header);
  if (!parsed.t || parsed.v1.length === 0) {
    throw Object.assign(new Error("Missing Stripe-Signature parts"), { status: 400 });
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - parsed.t) > SIGNATURE_TOLERANCE_SECONDS) {
    throw Object.assign(new Error("Signature timestamp outside tolerance"), { status: 400 });
  }
  const signedPayload = `${parsed.t}.${rawBody.toString("utf8")}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");
  for (const candidate of parsed.v1) {
    if (constantTimeEqualHex(expected, candidate)) return true;
  }
  throw Object.assign(new Error("Stripe signature mismatch"), { status: 400 });
}

async function activatePreseed(userId, stripeRef) {
  const now = new Date();
  const data = {
    tier: "preseed",
    status: "active",
    activatedAt: now.getTime(),
    source: "stripe-webhook",
    stripeRef: stripeRef || null,
  };
  await prisma.tinkerUserData.upsert({
    where: { userId_kind: { userId, kind: "subscription" } },
    create: { userId, kind: "subscription", data },
    update: { data },
  });
}

async function deactivatePreseed(userId, stripeRef) {
  const existing = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind: "subscription" } },
  });
  // Nothing to clear if we never recorded an active row.
  if (!existing) return;
  const data = {
    tier: "preseed",
    status: "inactive",
    activatedAt: existing.data && existing.data.activatedAt ? existing.data.activatedAt : null,
    deactivatedAt: Date.now(),
    source: "stripe-webhook",
    stripeRef: stripeRef || null,
  };
  await prisma.tinkerUserData.update({
    where: { userId_kind: { userId, kind: "subscription" } },
    data: { data },
  });
}

const handler = withResponseLogging(async function stripeWebhook(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    res.status(503).json({ error: "Webhook not configured" });
    return;
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || "Bad request" });
    return;
  }

  const signature = req.headers["stripe-signature"];
  try {
    verifySignature(rawBody, signature, secret);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || "Signature check failed" });
    return;
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = (event.data && event.data.object) || {};
      const userId = session.client_reference_id;
      // No client_reference_id → checkout wasn't initiated via
      // /api/checkout/preseed. Skip silently with a 200 so Stripe
      // doesn't retry forever.
      if (userId && typeof userId === "string") {
        const stripeRef = session.id || null;
        await activatePreseed(userId, stripeRef);
      }
    } else if (event.type === "customer.subscription.deleted") {
      const sub = (event.data && event.data.object) || {};
      // Stripe Payment Links don't surface client_reference_id on the
      // subscription object directly — it's on the checkout session
      // metadata. Look it up via the parent customer's metadata.
      const userId =
        (sub.metadata && sub.metadata.client_reference_id) ||
        (sub.metadata && sub.metadata.userId) ||
        null;
      if (userId && typeof userId === "string") {
        await deactivatePreseed(userId, sub.id || null);
      }
    }
    res.status(200).json({ received: true });
  } catch (err) {
    res.status(500).json({ error: err.message || "Internal error" });
  }
});

module.exports = handler;
// Tell Vercel's Node runtime not to JSON-parse the body — Stripe's
// signature is computed over the exact bytes it sent.
module.exports.config = { api: { bodyParser: false } };
