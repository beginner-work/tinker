/**
 * Better: PgBouncer-shaped pool (fixed size) in front of the same fake DB.
 * Concurrent requests borrow and return connections instead of connecting each time.
 */

export function createPool({ size = 8, queryDelayMs = 20 } = {}) {
  const idle = [];
  let created = 0;
  let waits = 0;
  let queries = 0;
  const waiters = [];

  function makeClient() {
    return {
      busy: false,
      async query(_sql) {
        queries += 1;
        await sleep(queryDelayMs);
        return { rows: [{ n: 1 }] };
      },
    };
  }

  async function acquire() {
    if (idle.length) return idle.pop();
    if (created < size) {
      created += 1;
      return makeClient();
    }
    waits += 1;
    return new Promise((resolve) => waiters.push(resolve));
  }

  function release(client) {
    if (waiters.length) waiters.shift()(client);
    else idle.push(client);
  }

  async function query(sql) {
    const client = await acquire();
    try {
      return await client.query(sql);
    } finally {
      release(client);
    }
  }

  return {
    query,
    stats: () => ({ created, idle: idle.length, waits, queries, size }),
  };
}

const pool = createPool({ size: 8 });

export async function handleRequest() {
  return pool.query("SELECT count(*) FROM events WHERE user_id = 42");
}

export async function runLoad(n = 40) {
  const t0 = performance.now();
  const results = await Promise.allSettled(
    Array.from({ length: n }, () => handleRequest())
  );
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const bad = results.length - ok;
  return {
    mode: "better",
    ok,
    bad,
    ms: performance.now() - t0,
    stats: pool.stats(),
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
