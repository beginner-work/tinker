/**
 * Burst-replay harness: baseline double-applies; better must not.
 * Also checks DLQ for a poison event.
 */
import assert from "node:assert/strict";
import * as baseline from "./baseline.js";
import * as better from "./better.js";

const events = Array.from({ length: 12 }, (_, i) => ({
  id: `evt_${i + 1}`,
  type: "payment_intent.succeeded",
  data: { object: { id: `pi_${i + 1}` } },
}));

const base = await baseline.burstReplay(events, 4);
const nice = await better.burstReplay(events, 4);

better.reset();
const poison = await better.handleWebhook({ id: "evt_poison", type: "poison.test" });

console.log("baseline=", base);
console.log("better=", nice);
console.log("poison=", poison, "dlq=", better.dlq.length);

assert.ok(base.duplicates_applied > 0, "baseline should double-apply on replay");
assert.equal(nice.duplicates_applied, 0, "better must not double-apply");
assert.equal(nice.side_effects, nice.unique_events);
assert.equal(poison.dlq, true);
assert.equal(better.dlq.length, 1);

const missingKey = better.createPaymentIntent({ amount: 500 });
assert.equal(missingKey.ok, false);
const withKey = better.createPaymentIntent({
  amount: 500,
  idempotencyKey: "agent_1",
});
assert.equal(withKey.ok, true);

console.log("pass");
