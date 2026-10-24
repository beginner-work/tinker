import assert from "node:assert/strict";
import * as baseline from "./baseline.js";
import * as better from "./better.js";

const base = await baseline.runLoad({ n: 40, queryDelayMs: 20 });
const nice = await better.runLoad({ n: 40, queryDelayMs: 20 });

console.log("baseline=", base);
console.log("better=", nice);

assert.ok(nice.ms < base.ms, "cached reads should be faster");
assert.ok(nice.hits > 10, "better should record cache hits");
assert.ok(nice.dbQueries < base.dbQueries, "better should query DB less");

better.reset();
await better.getProduct(1, { queryDelayMs: 5 });
await better.writeProduct(1, 42);
const after = await better.getProduct(1, { queryDelayMs: 5 });
assert.equal(after.inventory, 42);
assert.equal(after.cache, "miss_fill");

console.log("pass");
