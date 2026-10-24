/**
 * Burst-replay the same Stripe events many times. Baseline double-applies;
 * better should report duplicates_applied=0 (side effects == unique events).
 */
const BETTER = process.env.BETTER === "1";
const PORT = Number(process.env.PORT || (BETTER ? 5102 : 5101));
const TARGET = `http://127.0.0.1:${PORT}`;

const events = Array.from({ length: 20 }, (_, i) => ({
  id: `evt_${i + 1}`,
  type: "payment_intent.succeeded",
  data: { object: { id: `pi_${i + 1}` } },
}));

async function post(event) {
  const res = await fetch(`${TARGET}/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  // Warm
  await fetch(`${TARGET}/health`);

  // First delivery
  for (const event of events) await post(event);
  // Burst replay (simulates Stripe retries)
  const replays = [];
  for (let r = 0; r < 5; r += 1) {
    for (const event of events) replays.push(post(event));
  }
  await Promise.all(replays);

  // Allow queue drain
  await new Promise((r) => setTimeout(r, BETTER ? 500 : 50));
  const debug = await (await fetch(`${TARGET}/_debug/side-effects`)).json();
  const uniqueEvents = events.length;
  const applied = debug.sideEffects.length;
  const duplicatesApplied = Math.max(0, applied - uniqueEvents);

  console.log(
    JSON.stringify(
      {
        mode: BETTER ? "better" : "baseline",
        unique_events: uniqueEvents,
        side_effects: applied,
        duplicates_applied: duplicatesApplied,
        queue: debug.queue || null,
        dlq: (debug.dlq && debug.dlq.length) || 0,
      },
      null,
      2
    )
  );

  if (BETTER && duplicatesApplied !== 0) process.exit(1);
  if (!BETTER && duplicatesApplied === 0) {
    console.log("baseline unexpectedly had no duplicates (timing?)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
