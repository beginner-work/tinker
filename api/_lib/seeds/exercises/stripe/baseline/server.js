/**
 * Baseline at scale: Stripe webhooks processed inline on the request.
 * Replays double-apply side effects. No idempotency ledger, no DLQ.
 */
import http from "node:http";
import Stripe from "stripe";

const PORT = Number(process.env.PORT || 5101);
const stripe = new Stripe(process.env.STRIPE_API_KEY || "sk_test_123", {
  host: process.env.STRIPE_HOST || "127.0.0.1",
  port: Number(process.env.STRIPE_PORT || 12111),
  protocol: "http",
});

/** @type {string[]} */
export const sideEffects = [];
let processed = 0;

function applyEvent(event) {
  // Slow inline work (simulates emails / DB writes on the request thread).
  const start = Date.now();
  while (Date.now() - start < 15) {
    /* busy */
  }
  sideEffects.push(`${event.id}:${event.type}`);
  processed += 1;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          mode: "baseline",
          processed,
          sideEffects: sideEffects.length,
        })
      );
      return;
    }
    if (req.url === "/webhook" && req.method === "POST") {
      const raw = await readBody(req);
      const event = JSON.parse(raw.toString("utf8"));
      // Naive: trust body, process inline, no idempotency.
      applyEvent(event);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ received: true, processed }));
      return;
    }
    if (req.url === "/v1/payment_intents" && req.method === "POST") {
      const raw = await readBody(req);
      const body = JSON.parse(raw.toString("utf8") || "{}");
      // No Idempotency-Key forwarded to Stripe.
      const pi = await stripe.paymentIntents.create({
        amount: body.amount || 500,
        currency: body.currency || "usd",
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(pi));
      return;
    }
    if (req.url === "/_debug/side-effects") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ sideEffects, processed }));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  } catch (err) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
});

server.listen(PORT, () => {
  console.log(`baseline stripe webhook server on ${PORT} (inline, no ledger)`);
});
