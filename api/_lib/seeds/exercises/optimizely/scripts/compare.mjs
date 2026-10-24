import fs from "node:fs";

function load(p) {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}

console.log("=== Optimizely edge latency compare ===");
console.log(
  "Save k6 summaries:\n" +
    "  TARGET=http://127.0.0.1:3071 k6 run k6/load.js --summary-export=k6-summary-baseline.json\n" +
    "  TARGET=http://127.0.0.1:3072 k6 run k6/load.js --summary-export=k6-summary-better.json\n"
);
console.log("baseline=", load("k6-summary-baseline.json"));
console.log("better=", load("k6-summary-better.json"));
