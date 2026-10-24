/**
 * Baseline: open a new fake Postgres connection per query.
 * Under concurrency the fake server hits maxConnections and fails.
 */

export function createFakePostgres({ maxConnections = 8, queryDelayMs = 20 } = {}) {
  let open = 0;
  let queries = 0;
  let failures = 0;

  async function connect() {
    if (open >= maxConnections) {
      failures += 1;
      throw new Error("sorry, too many clients already");
    }
    open += 1;
    return {
      async query(_sql) {
        queries += 1;
        await sleep(queryDelayMs);
        return { rows: [{ n: 1 }] };
      },
      async end() {
        open -= 1;
      },
    };
  }

  return {
    connect,
    stats: () => ({ open, queries, failures, maxConnections }),
  };
}

const db = createFakePostgres({ maxConnections: 8 });

export async function handleRequest() {
  const client = await db.connect();
  try {
    return await client.query(
      "SELECT count(*) FROM events WHERE user_id = 42"
    );
  } finally {
    await client.end();
  }
}

export async function runLoad(n = 40) {
  const t0 = performance.now();
  const results = await Promise.allSettled(
    Array.from({ length: n }, () => handleRequest())
  );
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const bad = results.length - ok;
  return {
    mode: "baseline",
    ok,
    bad,
    ms: performance.now() - t0,
    stats: db.stats(),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
