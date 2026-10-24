/**
 * Better: in-memory fake Redis cache-aside with TTL.
 * Stretch helpers: invalidate on write, singleflight for stampedes.
 */

const products = new Map(
  Array.from({ length: 50 }, (_, i) => [
    i + 1,
    { id: i + 1, name: "Product " + (i + 1), inventory: 100 },
  ])
);

const cache = new Map(); // key -> { value, expires }
const inflight = new Map();
let dbQueries = 0;
let hits = 0;
let fills = 0;
let coalesced = 0;

export function reset() {
  cache.clear();
  inflight.clear();
  dbQueries = 0;
  hits = 0;
  fills = 0;
  coalesced = 0;
}

async function loadFromDb(id, queryDelayMs) {
  dbQueries += 1;
  fills += 1;
  await sleep(queryDelayMs);
  return products.get(id) || null;
}

export async function getProduct(id, { queryDelayMs = 30, ttlMs = 5_000 } = {}) {
  const key = "product:" + id;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expires > now) {
    hits += 1;
    return { ...hit.value, cache: "hit" };
  }

  if (inflight.has(key)) {
    coalesced += 1;
    const value = await inflight.get(key);
    return { ...value, cache: "coalesced" };
  }

  const pending = loadFromDb(id, queryDelayMs).then((value) => {
    if (value) cache.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  });
  inflight.set(key, pending);
  try {
    const value = await pending;
    return value ? { ...value, cache: "miss_fill" } : null;
  } finally {
    inflight.delete(key);
  }
}

export async function writeProduct(id, inventory) {
  const row = products.get(id);
  if (!row) return null;
  row.inventory = inventory;
  cache.delete("product:" + id);
  return { ...row, invalidated: true };
}

export async function runLoad({ n = 40, hotId = 1, queryDelayMs = 30 } = {}) {
  reset();
  const t0 = performance.now();
  // Warm the hot key once, then concurrent-ish sequential reads with hot bias.
  await getProduct(hotId, { queryDelayMs });
  for (let i = 0; i < n; i += 1) {
    const id = Math.random() < 0.7 ? hotId : (i % 50) + 1;
    await getProduct(id, { queryDelayMs });
  }
  return {
    mode: "better",
    n: n + 1,
    ms: performance.now() - t0,
    dbQueries,
    hits,
    fills,
    coalesced,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
