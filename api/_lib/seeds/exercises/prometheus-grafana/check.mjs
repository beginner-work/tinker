import assert from "node:assert/strict";
import * as baseline from "./baseline.js";
import * as better from "./better.js";

const base = baseline.runLoad(500);
const nice = better.runLoad(500);

console.log("baseline=", base);
console.log("better=", nice);

assert.ok(base.series > 100, "baseline series should explode");
assert.ok(nice.series <= 8, "better series should stay bounded");
assert.ok(nice.series < base.series / 10);
console.log("pass");
