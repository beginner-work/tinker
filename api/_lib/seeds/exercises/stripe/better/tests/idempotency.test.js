import assert from "node:assert/strict";
import { createWebhookQueue } from "../queue/worker.js";

async function main() {
  const applied = [];
  const q = createWebhookQueue({ concurrency: 2, maxAttempts: 3 });
  q.start(async (event) => {
    await new Promise((r) => setTimeout(r, 5));
    applied.push(event.id);
  });

  const event = { id: "evt_1", type: "payment_intent.succeeded" };
  q.accept(event);
  q.accept(event);
  q.accept(event);
  await q.drain();

  assert.equal(applied.length, 1, "event applied once");
  assert.equal(q.stats().duplicates >= 1, true, "duplicates counted");

  q.accept({ id: "evt_poison", type: "poison.test" });
  await q.drain();
  assert.equal(q.dlq.length, 1, "poison landed in DLQ");
  assert.equal(q.stats().deadLettered, 1);

  console.log("idempotency tests passed", q.stats());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
