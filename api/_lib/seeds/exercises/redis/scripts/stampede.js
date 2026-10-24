/**
 * Concurrent misses on the hot key against the better server.
 * Expect db fills ~= 1 (coalesced / locked), not one per waiter.
 */
const TARGET = process.env.TARGET || "http://127.0.0.1:5202";
const HOT_ID = process.env.HOT_ID || "1";

async function main() {
  // Invalidate via write so the next reads miss together.
  await fetch(`${TARGET}/products/${HOT_ID}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ inventory: 99 }),
  });

  const health0 = await (await fetch(`${TARGET}/health`)).json();
  const before = health0.dbQueries;

  const N = 40;
  const results = await Promise.all(
    Array.from({ length: N }, () => fetch(`${TARGET}/products/${HOT_ID}`).then((r) => r.json()))
  );

  const health1 = await (await fetch(`${TARGET}/health`)).json();
  const fills = health1.dbQueries - before;
  const caches = results.reduce((acc, r) => {
    acc[r.cache] = (acc[r.cache] || 0) + 1;
    return acc;
  }, {});

  console.log(
    JSON.stringify(
      {
        concurrent_readers: N,
        db_queries_during_stampede: fills,
        cache_modes: caches,
        cache_stats: health1.cache,
      },
      null,
      2
    )
  );
  if (fills > 3) {
    console.error("stampede protection weak: too many Postgres fills");
    process.exit(1);
  }
  console.log("stampede_protection=ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
