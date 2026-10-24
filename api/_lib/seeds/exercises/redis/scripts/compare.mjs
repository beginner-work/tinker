import fs from "node:fs";

function load(p) {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}

console.log("=== Redis cache scale compare ===");
console.log(
  "Save k6 summaries:\n" +
    "  TARGET=http://127.0.0.1:5201 k6 run k6/load.js --summary-export=k6-summary-baseline.json\n" +
    "  TARGET=http://127.0.0.1:5202 HOT_ID=1 k6 run k6/load.js --summary-export=k6-summary-better.json\n" +
    "Then: npm run stampede\n"
);
console.log("baseline=", load("k6-summary-baseline.json"));
console.log("better=", load("k6-summary-better.json"));
