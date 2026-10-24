import fs from "node:fs";

function load(path) {
  if (!fs.existsSync(path)) return null;
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

const baseline = load("k6-summary-baseline.json") || load("k6-summary.json");
const better = load("k6-summary-better.json");

console.log("=== Postgres scale compare ===");
console.log(
  "Run k6 twice and save summaries:\n" +
    "  TARGET=http://127.0.0.1:5401 k6 run k6/load.js --summary-export=k6-summary-baseline.json\n" +
    "  TARGET=http://127.0.0.1:5402 k6 run k6/load.js --summary-export=k6-summary-better.json\n"
);
console.log("baseline=", baseline);
console.log("better=", better);
if (baseline && better) {
  const bFail = baseline.http_req_failed?.rate ?? baseline.errors?.rate;
  const aFail = better.http_req_failed?.rate ?? better.errors?.rate;
  const bP95 = baseline.events_latency?.["p(95)"];
  const aP95 = better.events_latency?.["p(95)"];
  console.log({ baseline_fail_rate: bFail, better_fail_rate: aFail, baseline_p95: bP95, better_p95: aP95 });
}
