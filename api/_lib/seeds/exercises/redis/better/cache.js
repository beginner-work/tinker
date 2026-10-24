/**
 * Cache-aside helpers: get/set with TTL, delete on write, and singleflight
 * stampede protection (in-process coalescing + Redis SETNX lock).
 */
export function createCache(redis, opts = {}) {
  const ttlSeconds = opts.ttlSeconds || 30;
  const lockTtlMs = opts.lockTtlMs || 2000;
  const inflight = new Map();
  const stats = { hits: 0, misses: 0, fills: 0, coalesced: 0, lockWaits: 0 };

  function keyFor(id) {
    return `product:${id}`;
  }

  async function get(id) {
    const raw = await redis.get(keyFor(id));
    if (raw) {
      stats.hits += 1;
      return JSON.parse(raw);
    }
    stats.misses += 1;
    return null;
  }

  async function set(id, value) {
    await redis.set(keyFor(id), JSON.stringify(value), "EX", ttlSeconds);
  }

  async function invalidate(id) {
    await redis.del(keyFor(id));
  }

  /**
   * Load through cache with stampede protection:
   * 1) in-process singleflight for the same key
   * 2) Redis SETNX lock so multiple processes do one fill
   */
  async function getOrLoad(id, loader) {
    const cached = await get(id);
    if (cached) return { value: cached, cache: "hit" };

    if (inflight.has(id)) {
      stats.coalesced += 1;
      const value = await inflight.get(id);
      return { value, cache: "coalesced" };
    }

    const promise = (async () => {
      const lockKey = `lock:product:${id}`;
      const token = `${process.pid}-${Date.now()}-${Math.random()}`;
      const gotLock = await redis.set(lockKey, token, "PX", lockTtlMs, "NX");
      if (!gotLock) {
        stats.lockWaits += 1;
        for (let i = 0; i < 20; i += 1) {
          await new Promise((r) => setTimeout(r, 25));
          const again = await redis.get(keyFor(id));
          if (again) return JSON.parse(again);
        }
      }
      try {
        const still = await redis.get(keyFor(id));
        if (still) return JSON.parse(still);
        stats.fills += 1;
        const value = await loader(id);
        if (value) await set(id, value);
        return value;
      } finally {
        const current = await redis.get(lockKey);
        if (current === token) await redis.del(lockKey);
      }
    })();

    inflight.set(id, promise);
    try {
      const value = await promise;
      return { value, cache: "miss_fill" };
    } finally {
      inflight.delete(id);
    }
  }

  return { get, set, invalidate, getOrLoad, stats: () => ({ ...stats }), ttlSeconds };
}
