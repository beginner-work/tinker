/**
 * In-memory job queue with concurrency limit, token-bucket rate limit,
 * and response cache keyed by prompt.
 */
export function createQueue(opts = {}) {
  const concurrency = opts.concurrency || 4;
  const minIntervalMs = opts.minIntervalMs || 25;
  const cacheTtlMs = opts.cacheTtlMs || 30_000;
  const q = [];
  let active = 0;
  let nextSlot = 0;
  const cache = new Map();
  const stats = { enqueued: 0, completed: 0, cacheHits: 0, cacheMisses: 0 };

  function getCache(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expires) {
      cache.delete(key);
      return null;
    }
    return hit.value;
  }

  function setCache(key, value) {
    cache.set(key, { value, expires: Date.now() + cacheTtlMs });
  }

  function pump() {
    while (active < concurrency && q.length) {
      const job = q.shift();
      active += 1;
      const wait = Math.max(0, nextSlot - Date.now());
      nextSlot = Date.now() + wait + minIntervalMs;
      Promise.resolve()
        .then(() => new Promise((r) => setTimeout(r, wait)))
        .then(() => job.work())
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          stats.completed += 1;
          pump();
        });
    }
  }

  function enqueue(key, work) {
    stats.enqueued += 1;
    const cached = getCache(key);
    if (cached) {
      stats.cacheHits += 1;
      return Promise.resolve({ ...cached, cache: true });
    }
    stats.cacheMisses += 1;
    return new Promise((resolve, reject) => {
      q.push({
        resolve: (value) => {
          setCache(key, value);
          resolve({ ...value, cache: false });
        },
        reject,
        work,
      });
      pump();
    });
  }

  return { enqueue, stats: () => ({ ...stats, active, queued: q.length, cacheSize: cache.size }) };
}
