/**
 * Better: accept webhooks into a small in-memory queue with an idempotency
 * ledger keyed by Stripe event id, retries, and a dead-letter queue.
 *
 * Diff against baseline.js. Fake events only.
 */

/** @type {string[]} */
export const sideEffects = [];
/** @type {{ event: object, error: string }[]} */
export const dlq = [];

const ledger = new Map(); // eventId -> applied | inflight
const stats = {
  enqueued: 0,
  applied: 0,
  duplicates: 0,
  retries: 0,
  deadLettered: 0,
};

export function reset() {
  sideEffects.length = 0;
  dlq.length = 0;
  ledger.clear();
  stats.enqueued = 0;
  stats.applied = 0;
  stats.duplicates = 0;
  stats.retries = 0;
  stats.deadLettered = 0;
}

async function apply(event) {
  await sleep(12);
  sideEffects.push(`${event.id}:${event.type}`);
}

/**
 * Process one event with idempotency + retries.
 * Poison events (type === "poison.test") fail until DLQ.
 */
export async function handleWebhook(event, { maxAttempts = 3 } = {}) {
  stats.enqueued += 1;
  if (ledger.get(event.id) === "applied" || ledger.get(event.id) === "inflight") {
    stats.duplicates += 1;
    return { received: true, applied: false, duplicate: true };
  }

  let attempts = 0;
  while (attempts < maxAttempts) {
    attempts += 1;
    ledger.set(event.id, "inflight");
    try {
      if (event.type === "poison.test") throw new Error("poison message");
      await apply(event);
      ledger.set(event.id, "applied");
      stats.applied += 1;
      return { received: true, applied: true, duplicate: false };
    } catch (err) {
      ledger.delete(event.id);
      stats.retries += 1;
      if (attempts >= maxAttempts) {
        dlq.push({ event, error: String(err.message || err) });
        stats.deadLettered += 1;
        return { received: true, applied: false, dlq: true };
      }
    }
  }
  return { received: true, applied: false };
}

export async function burstReplay(events, replays = 5) {
  reset();
  for (const event of events) await handleWebhook(event);
  const jobs = [];
  for (let r = 0; r < replays; r += 1) {
    for (const event of events) jobs.push(handleWebhook(event));
  }
  await Promise.all(jobs);
  const unique = new Set(events.map((e) => e.id)).size;
  return {
    mode: "better",
    unique_events: unique,
    side_effects: sideEffects.length,
    duplicates_applied: Math.max(0, sideEffects.length - unique),
    stats: { ...stats },
    dlq: dlq.length,
  };
}

/** Stretch helper: agent-safe create requires an idempotency key. */
export function createPaymentIntent({ amount, currency, idempotencyKey }) {
  if (!idempotencyKey) {
    return {
      ok: false,
      error: { code: "idempotency_key_required" },
    };
  }
  return {
    ok: true,
    payment_intent: {
      id: "pi_test_" + String(idempotencyKey).slice(0, 8),
      amount: amount || 500,
      currency: currency || "usd",
      mode: "test",
    },
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
