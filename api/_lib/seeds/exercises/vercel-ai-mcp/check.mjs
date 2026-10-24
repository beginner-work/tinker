/**
 * Timing + assert harness: concurrent prompts and tool-choice evals.
 * Better must finish the batch faster and pass evals.
 */
import assert from "node:assert/strict";
import * as baseline from "./baseline.js";
import * as better from "./better.js";

const prompts = [
  "What is the status of order ord_100?",
  "Is ord_200 refunded already?",
  "Customer asks for a refund policy blurb",
  "lookup ord_100 please",
  "Where are refund docs?",
  "status for ord_200",
  "What is the status of order ord_100?",
  "Is ord_200 refunded already?",
];

const base = await baseline.runMany(prompts);
const nice = await better.runMany(prompts);
const evals = await better.runEvals();

console.log("baseline_ms=", base.ms.toFixed(1), "mode=", base.mode);
console.log("better_ms=", nice.ms.toFixed(1), "mode=", nice.mode, "queue=", nice.queue);
console.log("evals_passed=", evals.passed, "evals_ms=", evals.ms.toFixed(1));

assert.equal(nice.results.length, prompts.length);
assert.equal(base.results.length, prompts.length);
assert.ok(nice.ms < base.ms, `better should be faster (${nice.ms} vs ${base.ms})`);
assert.equal(evals.passed, 6);
assert.ok(
  nice.results.every((r) => r.tool === "lookup_order" || r.tool === "search_docs")
);

console.log("pass");
