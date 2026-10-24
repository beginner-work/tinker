/**
 * Better at scale: accept webhooks quickly, process on a queue with
 * idempotency, retries, and a DLQ. Agent-safe PaymentIntent create forwards
 * Stripe Idempotency-Key and uses test keys only.
 */
import http from "node:http";
import Stripe from "stripe";
import { createWebhookQueue } from "./queue/worker.js";

const PORT = Number(process.env.PORT || 5102);
const stripe = new Stripe(process.env.STRIPE_API_KEY || "sk_test_123", {
  host: process.env.STRIPE_HOST || "127.0.0.1",
  port: Number(process.env.STRIPE_PORT || 12111),
  protocol: "http",
});

/** @type {string[]} */
export const sideEffects = [];
const queue = createWebhookQueue({ concurrency: 4, maxAttempts: 3 });

queue.start(async (event) => {
  await new Promise((r) => setTimeout(r, 15));
  sideEffects.push(`${event.id}:${event.type}`);
});

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
          mode: "better",
          queue: queue.stats(),
          sideEffects: sideEffects.length,
        })
      );
      return;
    }
    if (req.url === "/webhook" && req.method === "POST") {
      const raw = await readBody(req);
      const event = JSON.parse(raw.toString("utf8"));
      if (!event.id || !event.type) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_event" }));
        return;
      }
      const accepted = queue.accept(event);
      res.writeHead(202, { "content-type": "application/json" });
      res.end(JSON.stringify(accepted));
      return;
    }
    if (req.url === "/v1/payment_intents" && req.method === "POST") {
      const raw = await readBody(req);
      const body = JSON.parse(raw.toString("utf8") || "{}");
      const idem = String(req.headers["idempotency-key"] || "").trim();
      if (!idem) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              code: "idempotency_key_required",
              message: "Agent callers must send Idempotency-Key",
            },
          })
        );
        return;
      }
      const key = process.env.STRIPE_API_KEY || "sk_test_123";
      if (!String(key).startsWith("sk_test_")) {
        res.writeHead(403, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "test_mode_only" } }));
        return;
      }
      const pi = await stripe.paymentIntents.create(
        {
          amount: Number(body.amount) || 500,
          currency: body.currency || "usd",
        },
        { idempotencyKey: idem }
      );
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: pi.id, amount: pi.amount, mode: "test" }));
      return;
    }
    if (req.url === "/_debug/side-effects") {
      await queue.drain();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          sideEffects,
          queue: queue.stats(),
          dlq: queue.dlq,
        })
      );
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
  console.log(`better stripe webhook server on ${PORT} (queue + idempotency + DLQ)`);
});
