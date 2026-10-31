#!/usr/bin/env node
/* Print reading-agent metric counts from Postgres.
 *
 *   DATABASE_URL=… node scripts/reading-metrics.js
 *   DATABASE_URL=… node scripts/reading-metrics.js --json
 *
 * Reports: sessions, questions, linked-source fetches, avg answer
 * latency, LinkedIn/email clicks, and sessions grouped by companyHost
 * (the article hostname, for per-target-company splits).
 */

"use strict";

const prisma = require("../api/_lib/db.js");
const { collectMetrics } = require("../api/_lib/reading-agent.js");

async function main() {
  const asJson = process.argv.includes("--json");
  const metrics = await collectMetrics(prisma);
  if (asJson) {
    process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
  } else {
    console.log("Reading agent metrics");
    console.log(`  sessions:              ${metrics.sessions}`);
    console.log(`  questions:             ${metrics.questions}`);
    console.log(`  questionsWithFetch:    ${metrics.questionsWithFetch}`);
    console.log(`  answerLatencyMsAvg:    ${metrics.answerLatencyMsAvg}`);
    console.log(`  clicksLinkedIn:        ${metrics.clicksLinkedIn}`);
    console.log(`  clicksEmail:           ${metrics.clicksEmail}`);
    console.log("  byCompanyHost:");
    for (const row of metrics.byCompanyHost || []) {
      console.log(`    ${row.companyHost}: ${row.sessions}`);
    }
  }
  await prisma.$disconnect().catch(() => {});
}

main().catch(async (err) => {
  console.error(err && err.message ? err.message : err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
