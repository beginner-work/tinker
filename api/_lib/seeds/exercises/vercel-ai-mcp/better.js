/**
 * Better: same stub LLM + MCP tools, but a concurrent job queue, light rate
 * limit, and response cache. Evals can run in parallel.
 *
 * Diff against baseline.js. Target shape for the 45-minute core change.
 */

const ORDERS = {
  ord_100: { id: "ord_100", status: "paid", amount_cents: 4200 },
  ord_200: { id: "ord_200", status: "refunded", amount_cents: 1500 },
};

const mcpTools = {
  async listTools() {
    return ["lookup_order", "search_docs"];
  },
  async callTool(name, args) {
    await sleep(25);
    if (name === "lookup_order") return ORDERS[args.orderId] || { error: "not_found" };
    if (name === "search_docs") {
      return {
        snippet: String(args.query || "").toLowerCase().includes("refund")
          ? "Refunds take 3 to 5 business days."
          : "No doc match.",
      };
    }
    throw new Error("unknown tool: " + name);
  },
};

export function chooseTool(prompt) {
  const order = String(prompt).match(/\bord_[a-z0-9]+\b/i);
  if (order) return { name: "lookup_order", args: { orderId: order[0] } };
  return { name: "search_docs", args: { query: String(prompt) } };
}

export function createQueue({ concurrency = 4, minIntervalMs = 5, cacheTtlMs = 15_000 } = {}) {
  const q = [];
  let active = 0;
  let nextSlot = 0;
  const cache = new Map();
  const stats = { enqueued: 0, completed: 0, cacheHits: 0, cacheMisses: 0 };

  function pump() {
    while (active < concurrency && q.length) {
      const job = q.shift();
      active += 1;
      const wait = Math.max(0, nextSlot - Date.now());
      nextSlot = Date.now() + wait + minIntervalMs;
      Promise.resolve()
        .then(() => sleep(wait))
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
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) {
      stats.cacheHits += 1;
      return Promise.resolve({ ...hit.value, cache: true });
    }
    stats.cacheMisses += 1;
    return new Promise((resolve, reject) => {
      q.push({
        resolve: (value) => {
          cache.set(key, { value, expires: Date.now() + cacheTtlMs });
          resolve({ ...value, cache: false });
        },
        reject,
        work,
      });
      pump();
    });
  }

  return { enqueue, stats: () => ({ ...stats, active, queued: q.length }) };
}

const queue = createQueue({ concurrency: 4 });

export async function runAgent(prompt) {
  return queue.enqueue(prompt, async () => {
    await sleep(15);
    const pick = chooseTool(prompt);
    const toolResult = await mcpTools.callTool(pick.name, pick.args);
    return { tool: pick.name, toolResult, mode: "queued" };
  });
}

export async function runMany(prompts) {
  const t0 = performance.now();
  const results = await Promise.all(prompts.map((p) => runAgent(p)));
  return {
    results,
    ms: performance.now() - t0,
    mode: "queued",
    queue: queue.stats(),
  };
}

/** Parallel evals: tool-choice cases run with a small worker pool. */
export async function runEvals() {
  const cases = [
    { prompt: "What is the status of order ord_100?", expect: "lookup_order" },
    { prompt: "Is ord_200 refunded already?", expect: "lookup_order" },
    { prompt: "Customer asks for a refund policy blurb", expect: "search_docs" },
    { prompt: "lookup ord_100 please", expect: "lookup_order" },
    { prompt: "Where are refund docs?", expect: "search_docs" },
    { prompt: "status for ord_200", expect: "lookup_order" },
  ];

  const t0 = performance.now();
  const results = await mapPool(cases, 4, async (c) => {
    const pick = chooseTool(c.prompt);
    if (pick.name !== c.expect) {
      throw new Error(`eval fail: ${c.prompt} -> ${pick.name}, want ${c.expect}`);
    }
    return c.expect;
  });
  return { passed: results.length, ms: performance.now() - t0 };
}

async function mapPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      out[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
