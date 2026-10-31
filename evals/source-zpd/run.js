#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { runSourceZpd } = require("./lib/run.js");

async function maybeLogBraintrust(report) {
  const key = String(process.env.BRAINTRUST_API_KEY || "").trim();
  if (!key) {
    console.error("[source-zpd] BRAINTRUST_API_KEY missing; not logging");
    return;
  }
  try {
    const { initLogger } = require("braintrust");
    const logger = initLogger({
      projectName: "tinker-source-zpd",
      apiKey: key,
    });
    await logger.traced(async (span) => {
      span.log({
        input: { caseCount: report.caseCount, internal: true },
        output: {
          tinkerHitRate: report.tinker.hitRate,
          claudeHitRate: report.claude.hitRate,
          claudeSkipped: report.claude.skipped,
        },
        metadata: { goalsNote: report.goalsNote },
      });
    }, { name: "source-zpd-report" });
    console.error("[source-zpd] logged to Braintrust project tinker-source-zpd");
  } catch (err) {
    console.error(
      "[source-zpd] Braintrust log failed:",
      err && err.message ? err.message : err,
    );
  }
}

async function main() {
  const report = await runSourceZpd();
  const outPath = path.join(__dirname, "last-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.error(`[source-zpd] wrote ${outPath}`);
  await maybeLogBraintrust(report);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
