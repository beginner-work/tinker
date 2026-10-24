/**
 * Parallel evals: run tool-choice cases with a worker pool.
 * Baseline-style serial eval is shown for contrast in the summary.
 */
import assert from "node:assert/strict";
import { runAgent } from "../agent.js";

const cases = [
  { name: "order status", prompt: "What is the status of order ord_100?", expectTool: "lookup_order" },
  { name: "refunded order", prompt: "Is ord_200 refunded already?", expectTool: "lookup_order" },
  { name: "policy blurb", prompt: "Customer asks for a refund policy blurb", expectTool: "search_docs" },
  { name: "order again", prompt: "lookup ord_100 please", expectTool: "lookup_order" },
  { name: "docs again", prompt: "Where are refund docs?", expectTool: "search_docs" },
  { name: "order three", prompt: "status for ord_200", expectTool: "lookup_order" },
];

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i;
      i += 1;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function main() {
  const tSerial0 = performance.now();
  for (const c of cases) {
    const out = await runAgent(c.prompt);
    assert.equal(out.tool, c.expectTool, c.name);
  }
  const serialMs = performance.now() - tSerial0;

  const tPar0 = performance.now();
  const results = await mapPool(cases, 4, async (c) => {
    const out = await runAgent(c.prompt);
    assert.equal(out.tool, c.expectTool, c.name);
    return c.name;
  });
  const parallelMs = performance.now() - tPar0;

  console.log("evals_passed=", results.length);
  console.log(`serial_ms=${serialMs.toFixed(1)}`);
  console.log(`parallel_ms=${parallelMs.toFixed(1)}`);
  console.log(
    parallelMs < serialMs
      ? "parallel_evals=faster"
      : "parallel_evals=check_machine_load"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
