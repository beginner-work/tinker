#!/usr/bin/env node
/* Promote logged POST /api/ask questions into visitor dataset stubs.
 *
 * Schema-ready for a later UI where Tyler attaches tyler_answer.
 * This script only writes candidate JSON files with tyler_answer: null.
 *
 * Usage:
 *   DATABASE_URL=… node scripts/promote-ask-logs.js [--limit 50] [--dry-run]
 *   node scripts/promote-ask-logs.js --from-json path/to/ask-requests.json
 *
 * Then: npm run eval:ask:build
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const OUT_DIR = path.join(__dirname, "..", "evals", "ask", "dataset", "visitor");

function parseArgs(argv) {
  const out = { limit: 50, dryRun: false, fromJson: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--limit") out.limit = Math.max(1, Number(argv[++i]) || 50);
    else if (a === "--from-json") out.fromJson = String(argv[++i] || "");
  }
  return out;
}

function stubId(question) {
  const h = crypto.createHash("sha1").update(String(question)).digest("hex").slice(0, 10);
  return `visitor-${h}`;
}

function toStub(row) {
  const question = String(row.question || row.editedTranscript || "").trim();
  if (!question) return null;
  return {
    id: stubId(question),
    question,
    source: "visitor",
    tyler_answer: null,
    category: "agreement",
    input: row.inputType === "voice" ? "voice" : "typed",
    rawTranscript: row.rawTranscript || "",
    sourceId: row.sourceId || "lindowlabs-minds-and-models",
    notes:
      "Promoted from AskRequest log. Attach tyler_answer when Tyler writes the gold reply. UI not in this PR.",
    expect: {
      minSentences: 1,
      maxSentences: 6,
    },
    promotedFrom: {
      askRequestId: row.id || null,
      caller: row.caller || null,
      createdAt: row.createdAt || null,
    },
  };
}

async function loadFromDb(limit) {
  if (!process.env.DATABASE_URL) {
    throw Object.assign(new Error("DATABASE_URL is not set"), { code: "NO_DB" });
  }
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  try {
    return await prisma.askRequest.findMany({
      where: { status: "ok" },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  } finally {
    await prisma.$disconnect();
  }
}

function loadFromJson(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Array.isArray(raw) ? raw : raw.rows || raw.requests || [];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let rows = [];
  if (args.fromJson) {
    rows = loadFromJson(args.fromJson);
  } else {
    try {
      rows = await loadFromDb(args.limit);
    } catch (err) {
      if (err && err.code === "NO_DB") {
        console.error(
          "DATABASE_URL missing. Pass --from-json <ask-requests.json> " +
            "or set DATABASE_URL to read AskRequest rows.",
        );
        process.exit(2);
      }
      throw err;
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let written = 0;
  let skipped = 0;
  for (const row of rows.slice(0, args.limit)) {
    const stub = toStub(row);
    if (!stub) {
      skipped++;
      continue;
    }
    const dest = path.join(OUT_DIR, `${stub.id}.json`);
    if (fs.existsSync(dest)) {
      skipped++;
      continue;
    }
    if (!args.dryRun) {
      fs.writeFileSync(dest, JSON.stringify(stub, null, 2) + "\n");
    }
    written++;
    console.error(`${args.dryRun ? "would write" : "wrote"} ${dest}`);
  }
  console.log(JSON.stringify({ written, skipped, outDir: OUT_DIR, dryRun: args.dryRun }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
