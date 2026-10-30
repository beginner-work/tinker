#!/usr/bin/env node
/* Snapshot Tyler's essays from Postgres (TinkerUserData kind=essays)
 * into evals/ask/fixtures/essays.json for the Braintrust baseline.
 *
 * Usage:
 *   DATABASE_URL=… node scripts/snapshot-ask-essays.js
 *
 * Does not invent essays. Exits 2 if DATABASE_URL is missing.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const OUT = path.join(__dirname, "..", "evals", "ask", "fixtures", "essays.json");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Cannot snapshot production essays.\n" +
        "Set DATABASE_URL (same Postgres as TinkerUserData) and re-run.\n" +
        "Alternatively refresh fixtures via the tinker MCP list_essays/read_essay tools.",
    );
    process.exit(2);
  }

  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  try {
    // Prefer owner allowlist when set; else take the user with the most essays.
    const allow = String(process.env.LEADS_OWNER_ALLOWLIST || process.env.METRICS_OWNER_ALLOWLIST || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const rows = await prisma.tinkerUserData.findMany({
      where: {
        kind: "essays",
        ...(allow.length ? { userId: { in: allow } } : {}),
      },
      orderBy: { updatedAt: "desc" },
    });

    let best = null;
    for (const row of rows) {
      const data = row.data;
      const essays = Array.isArray(data)
        ? data
        : data && Array.isArray(data.essays)
          ? data.essays
          : [];
      if (!best || essays.length > best.essays.length) {
        best = { userId: row.userId, essays, updatedAt: row.updatedAt };
      }
    }

    if (!best || !best.essays.length) {
      console.error("No essays found in TinkerUserData kind=essays.");
      process.exit(1);
    }

    const cleaned = best.essays
      .filter((e) => e && e.id && e.body != null)
      .map((e) => ({
        id: String(e.id),
        title: e.title || "",
        storedTitle: e.storedTitle || e.title || "",
        side: e.contentType === "technical" ? "Development" : "Founder Source",
        contentType: e.contentType || "business",
        createdAt: e.createdAt || null,
        updatedAt: e.updatedAt || null,
        wordCount:
          typeof e.wordCount === "number"
            ? e.wordCount
            : String(e.body || "")
                .trim()
                .split(/\s+/)
                .filter(Boolean).length,
        body: String(e.body || ""),
        transcript: Array.isArray(e.transcript) ? e.transcript : undefined,
      }));

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const payload = {
      snappedAt: new Date().toISOString(),
      userId: best.userId,
      count: cleaned.length,
      essays: cleaned,
    };
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
    console.log(
      JSON.stringify(
        { ok: true, path: OUT, count: cleaned.length, userId: best.userId },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
