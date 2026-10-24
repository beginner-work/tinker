/**
 * Baseline: Stripe-shaped webhooks processed inline.
 * Replays double-apply side effects. No idempotency ledger. No DLQ.
 *
 * Fake events only. No Stripe SDK, keys, or network.
 */

/** @type {string[]} */
export const sideEffects = [];

export function reset() {
  sideEffects.length = 0;
}

/** Simulate slow inline work (email / DB) on the request thread. */
export async function handleWebhook(event) {
  await sleep(12);
  sideEffects.push(`${event.id}:${event.type}`);
  return { received: true, applied: true };
}

/** Burst replay: deliver each event, then replay the same ids many times. */
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
    mode: "baseline",
    unique_events: unique,
    side_effects: sideEffects.length,
    duplicates_applied: Math.max(0, sideEffects.length - unique),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
