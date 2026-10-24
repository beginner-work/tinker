import assert from "node:assert/strict";
import * as baseline from "./baseline.js";
import * as better from "./better.js";

const base = await baseline.runLoad(40);
const nice = await better.runLoad(40);

console.log("baseline=", base);
console.log("better=", nice);

assert.ok(base.bad > 0, "baseline should fail some connections under load");
assert.equal(nice.bad, 0, "better pool should serve all requests");
assert.equal(nice.ok, 40, "better should complete the full batch");
assert.ok(nice.stats.queries === 40, "pooled queries should all run");
console.log("pass");

