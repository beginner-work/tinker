#!/usr/bin/env node
/* Offline + keyed EdNet ZPD benchmark entrypoint.
 *
 * Always runs Tinker + BKT on the seeded sample (synthetic fixture if
 * EdNet is not downloaded). Claude runs only with ANTHROPIC_API_KEY.
 * Braintrust logging only with BRAINTRUST_API_KEY.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { runEdnetZpd } = require("./lib/run.js");

async function maybeLogBraintrust(report) {
  const key = String(process.env.BRAINTRUST_API_KEY || "").trim();
  if (!key) {
    console.error("[ednet-zpd] BRAINTRUST_API_KEY missing; not logging experiment");
    return null;
  }
  try {
    const { initLogger } = require("braintrust");
    const logger = initLogger({
      projectName: "tinker-ednet-zpd",
      apiKey: key,
    });
    await logger.traced(async (span) => {
      span.log({
        input: {
          source: report.source,
          probeCount: report.probeCount,
          config: report.config,
        },
        output: report.baselines,
        metadata: { goalsNote: report.goalsNote },
      });
    }, { name: "ednet-zpd-report" });
    console.error("[ednet-zpd] logged to Braintrust project tinker-ednet-zpd");
    return true;
  } catch (err) {
    console.error(
      "[ednet-zpd] Braintrust log failed:",
      err && err.message ? err.message : err,
    );
    return false;
  }
}

async function main() {
  const report = await runEdnetZpd();
  const outPath = path.join(__dirname, "last-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error(`[ednet-zpd] wrote ${outPath}`);
  await maybeLogBraintrust(report);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = { maybeLogBraintrust };
