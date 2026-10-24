/**
 * Webhook queue: concurrency-limited workers, retries, dead-letter queue,
 * and an idempotency ledger keyed by Stripe event id.
 */
export function createWebhookQueue(opts = {}) {
  const concurrency = opts.concurrency || 4;
  const maxAttempts = opts.maxAttempts || 3;
  const q = [];
  const dlq = [];
  const ledger = new Map(); // eventId -> applied | inflight
  let active = 0;
  let applyFn = null;
  const stats = {
    enqueued: 0,
    applied: 0,
    duplicates: 0,
    retries: 0,
    deadLettered: 0,
  };

  async function runJob(job) {
    if (ledger.get(job.event.id) === "applied") {
      stats.duplicates += 1;
      return;
    }
    if (ledger.get(job.event.id) === "inflight") {
      stats.duplicates += 1;
      return;
    }
    ledger.set(job.event.id, "inflight");
    try {
      if (job.event.type === "poison.test") throw new Error("poison message");
      await applyFn(job.event);
      ledger.set(job.event.id, "applied");
      stats.applied += 1;
    } catch (err) {
      ledger.delete(job.event.id);
      job.attempts += 1;
      stats.retries += 1;
      if (job.attempts >= maxAttempts) {
        dlq.push({ event: job.event, error: String(err.message || err) });
        stats.deadLettered += 1;
      } else {
        q.push(job);
      }
    }
  }

  function pump() {
    while (active < concurrency && q.length && applyFn) {
      const job = q.shift();
      active += 1;
      runJob(job).finally(() => {
        active -= 1;
        pump();
      });
    }
  }

  return {
    start(apply) {
      applyFn = apply;
      pump();
    },
    accept(event) {
      stats.enqueued += 1;
      if (ledger.get(event.id) === "applied" || ledger.get(event.id) === "inflight") {
        stats.duplicates += 1;
        return { accepted: true, duplicate: true };
      }
      q.push({ event, attempts: 0 });
      pump();
      return { accepted: true, duplicate: false };
    },
    async drain() {
      while (q.length || active) {
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    stats: () => ({ ...stats, active, queued: q.length, dlq: dlq.length }),
    dlq,
    ledger,
  };
}
