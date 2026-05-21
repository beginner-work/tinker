/* POST /api/payment/webhook
 *
 * Stripe webhook receiver. Verifies the Stripe-Signature header against
 * STRIPE_WEBHOOK_SECRET, then updates the user's TinkerUserData row
 * (kind="subscription") on subscription state changes.
 *
 * Subscriptions live as a JSONB blob on the existing TinkerUserData
 * table (rather than introducing a new users table) so the same auth
 * + db plumbing as essays / drafts / tree works unchanged.
 *
 * Events handled:
 *   - checkout.session.completed       → status="active"
 *   - customer.subscription.updated    → mirror Stripe status
 *   - customer.subscription.deleted    → status="canceled"
 *
 * Env vars required:
 *   - STRIPE_SECRET_KEY      — used to look up the subscription record
 *   - STRIPE_WEBHOOK_SECRET  — signs incoming events
 */

"use strict";

const crypto = require("crypto");
const prisma = require("../_lib/db.js");
const { withResponseLogging } = require("../_lib/log.js");

// Vercel's Node runtime parses JSON automatically — but Stripe signatures
// are computed against the raw bytes, so we have to disable that and
// read the body ourselves.
module.exports.config = { api: { bodyParser: false } };

const MAX_BYTES = 1024 * 1024;
// Stripe signs events with a timestamp + payload + secret. The tolerance
// window protects against replay; Stripe's recommended default is 300s.
const SIGNATURE_TOLERANCE_SECONDS = 300;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && Buffer.isBuffer(req.body)) {
      resolve(req.body);
      return;
    }
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

function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  // Stripe-Signature: t=<ts>,v1=<sig>[,v1=<sig>...]
  const parts = signatureHeader.split(",").map((s) => s.trim());
  let timestamp = null;
  const signatures = [];
  for (const part of parts) {
    const [k, v] = part.split("=");
    if (k === "t") timestamp = parseInt(v, 10);
    if (k === "v1") signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) return false;
  // Optional clock skew protection.
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const payload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  for (const sig of signatures) {
    if (sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

async function getSubscriptionFromStripe({ secretKey, subscriptionId }) {
  if (!subscriptionId) return null;
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { "Authorization": `Bearer ${secretKey}` },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

async function writeSubscription(userId, blob) {
  await prisma.tinkerUserData.upsert({
    where: { userId_kind: { userId, kind: "subscription" } },
    create: { userId, kind: "subscription", data: blob },
    update: { data: blob },
  });
}

async function handleCheckoutCompleted(event, secretKey) {
  const session = event.data && event.data.object;
  if (!session) return;
  const userId = session.client_reference_id || "";
  if (!userId) return;
  let currentPeriodEnd = null;
  if (session.subscription) {
    const sub = await getSubscriptionFromStripe({ secretKey, subscriptionId: session.subscription });
    if (sub && typeof sub.current_period_end === "number") {
      currentPeriodEnd = sub.current_period_end;
    }
  }
  await writeSubscription(userId, {
    sharpening: {
      status: "active",
      currentPeriodEnd,
      stripeSubscriptionId: session.subscription || null,
      stripeCustomerId: session.customer || null,
    },
  });
}

async function handleSubscriptionUpdated(event) {
  const sub = event.data && event.data.object;
  if (!sub) return;
  const userId = (sub.metadata && sub.metadata.tinker_user_id) || null;
  // Stripe doesn't put client_reference_id on the subscription itself —
  // we have to find the user by stripe customer ID via our own table.
  // For v1 we encode the user id in subscription metadata at create
  // time (TODO when payment goes live; for now skip if absent).
  if (!userId) return;
  const status = sub.status === "active" || sub.status === "trialing" ? "active" : sub.status;
  await writeSubscription(userId, {
    sharpening: {
      status,
      currentPeriodEnd: typeof sub.current_period_end === "number" ? sub.current_period_end : null,
      stripeSubscriptionId: sub.id,
      stripeCustomerId: sub.customer || null,
    },
  });
}

async function handleSubscriptionDeleted(event) {
  const sub = event.data && event.data.object;
  if (!sub) return;
  const userId = (sub.metadata && sub.metadata.tinker_user_id) || null;
  if (!userId) return;
  await writeSubscription(userId, {
    sharpening: {
      status: "canceled",
      currentPeriodEnd: typeof sub.current_period_end === "number" ? sub.current_period_end : null,
      stripeSubscriptionId: sub.id,
      stripeCustomerId: sub.customer || null,
    },
  });
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || !webhookSecret) {
    res.status(503).json({ error: "Stripe webhook is not configured." });
    return;
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || "Bad request" });
    return;
  }

  const signature = req.headers && (req.headers["stripe-signature"] || req.headers["Stripe-Signature"]);
  if (!verifySignature(raw, signature, webhookSecret)) {
    res.status(400).json({ error: "Bad signature" });
    return;
  }

  let event;
  try {
    event = JSON.parse(raw.toString("utf8"));
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event, secretKey);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event);
        break;
      default:
        // Ignore other event types.
        break;
    }
  } catch (err) {
    // Acknowledge to Stripe but log; Stripe will retry on a non-2xx.
    res.status(500).json({ error: (err && err.message) || "Webhook error" });
    return;
  }

  res.status(200).json({ received: true });
});
