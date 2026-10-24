import assert from "node:assert/strict";
import * as baseline from "./baseline.js";
import * as better from "./better.js";

const base = await baseline.runLoad(80);
const nice = await better.runLoad(80);

console.log("baseline=", base);
console.log("better=", nice);

assert.ok(nice.total_ms < base.total_ms / 2, "local decide should be much faster");
assert.ok(nice.p95_ms < base.p95_ms / 2);
assert.equal(nice.sample[0].variationKey, nice.sample[1].variationKey, "sticky");
assert.equal(nice.sample[0].source, "local_datafile");
console.log("pass");
