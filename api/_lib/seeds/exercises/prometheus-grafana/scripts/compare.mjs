import fs from "node:fs";

function load(p) {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}

console.log("=== Prometheus cardinality / latency compare ===");
console.log(
  "Save k6 summaries:\n" +
    "  TARGET=http://127.0.0.1:5091 k6 run k6/load.js --summary-export=k6-summary-baseline.json\n" +
    "  TARGET=http://127.0.0.1:5092 k6 run k6/load.js --summary-export=k6-summary-better.json\n"
);
console.log("baseline=", load("k6-summary-baseline.json"));
console.log("better=", load("k6-summary-better.json"));
console.log("Better should keep reported_series flat; baseline climbs with unique user_ids.");
