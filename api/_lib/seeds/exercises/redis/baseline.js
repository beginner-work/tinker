/**
 * Baseline: every product read hits a slow fake DB. No cache.
 */

const products = new Map(
  Array.from({ length: 50 }, (_, i) => [
    i + 1,
    { id: i + 1, name: "Product " + (i + 1), inventory: 100 },
  ])
);

let dbQueries = 0;

export function reset() {
  dbQueries = 0;
}

export async function getProduct(id, { queryDelayMs = 30 } = {}) {
  dbQueries += 1;
  await sleep(queryDelayMs);
  return products.get(id) || null;
}

export async function runLoad({ n = 40, hotId = 1, queryDelayMs = 30 } = {}) {
  reset();
  const t0 = performance.now();
  const results = [];
  for (let i = 0; i < n; i += 1) {
    const id = Math.random() < 0.7 ? hotId : (i % 50) + 1;
    results.push(await getProduct(id, { queryDelayMs }));
  }
  return {
    mode: "baseline",
    n,
    ms: performance.now() - t0,
    dbQueries,
    hits: 0,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
