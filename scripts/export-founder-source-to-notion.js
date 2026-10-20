#!/usr/bin/env node
/* One-time: copy Founder Source essays into the owner's Notion Essays DB.
 *
 * Prefers a live session against production (or --base-url). Falls back to
 * direct DATABASE_URL + Notion token store when --direct is set.
 *
 * Prerequisites:
 *   1. Connect Notion from the writing app
 *   2. Paste a parent page URL on Connections and Save
 *
 * Usage:
 *   # Dry-run via API (session JWT from the signed-in browser):
 *   TINKER_SESSION_TOKEN=... node scripts/export-founder-source-to-notion.js --dry-run
 *
 *   # Write for real:
 *   TINKER_SESSION_TOKEN=... node scripts/export-founder-source-to-notion.js
 *
 *   # Direct against Postgres (ops / cloud agent with DATABASE_URL):
 *   DATABASE_URL=... node scripts/export-founder-source-to-notion.js --direct --user <stytchUserId> --dry-run
 *   DATABASE_URL=... node scripts/export-founder-source-to-notion.js --direct --owner-lindow-labs
 */

"use strict";

const path = require("path");

const DEFAULT_BASE = "https://tinker.beginner.work";

function readArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] || null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function loadDotEnv() {
  const fs = require("fs");
  for (const name of [".env.local", ".env"]) {
    const p = path.resolve(__dirname, "..", name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const [, key, rawValue] = m;
      if (process.env[key] != null) continue;
      let value = rawValue.trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

async function resolveLindowOwner() {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) throw new Error("DATABASE_URL is required to resolve the Lindow Labs owner.");
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const row = await prisma.targetCompany.findFirst({
      where: { name: { equals: "Lindow Labs", mode: "insensitive" } },
      select: { userId: true, name: true },
      orderBy: { updatedAt: "desc" },
    });
    if (!row || !row.userId) throw new Error("No TargetCompany named Lindow Labs.");
    return row.userId;
  } finally {
    await prisma.$disconnect();
  }
}

async function runViaApi({ dryRun }) {
  const token = String(
    process.env.TINKER_SESSION_TOKEN || process.env.STYTCH_SESSION_TOKEN || "",
  ).trim();
  if (!token) {
    throw new Error(
      "TINKER_SESSION_TOKEN is required (Stytch session JWT from a signed-in browser).",
    );
  }
  const base = String(
    readArg("--base-url") || process.env.TINKER_BASE_URL || DEFAULT_BASE,
  ).replace(/\/$/, "");
  const url =
    base +
    "/api/notion-essays?action=export-founder-source" +
    (dryRun ? "&dryRun=1" : "");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ dryRun }),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      "Export failed with HTTP " +
        response.status +
        (text ? ": " + text.slice(0, 300) : ""),
    );
  }
  if (response.status !== 200) {
    throw new Error(
      (body && body.error) ||
        "Export failed with HTTP " + response.status,
    );
  }
  return body.export || body;
}

async function runDirect({ dryRun }) {
  if (!String(process.env.DATABASE_URL || "").trim()) {
    throw new Error("DATABASE_URL is required for --direct.");
  }
  let userId = String(readArg("--user") || "").trim();
  if (!userId && hasFlag("--owner-lindow-labs")) {
    userId = await resolveLindowOwner();
  }
  if (!userId) {
    throw new Error("Pass --user <id> or --owner-lindow-labs with --direct.");
  }
  const exporter = require("../api/_lib/notion-essays-export.js");
  return exporter.exportFounderSourceEssays({ userId, dryRun });
}

async function main() {
  loadDotEnv();
  if (hasFlag("-h") || hasFlag("--help")) {
    process.stdout.write(
      [
        "Usage:",
        "  TINKER_SESSION_TOKEN=… node scripts/export-founder-source-to-notion.js [--dry-run]",
        "  DATABASE_URL=… node scripts/export-founder-source-to-notion.js --direct --owner-lindow-labs [--dry-run]",
        "",
        "Copies Founder Source essays into the Notion Essays database.",
        "Skips essays already present (by Tinker id or title).",
      ].join("\n") + "\n",
    );
    return;
  }

  const dryRun = hasFlag("--dry-run") || hasFlag("--dryRun");
  const result = hasFlag("--direct")
    ? await runDirect({ dryRun })
    : await runViaApi({ dryRun });

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(
    `\n── Summary ──\n` +
      `  found   : ${result.found}\n` +
      `  written : ${result.written}${dryRun ? " (dry-run)" : ""}\n` +
      `  skipped : ${result.skipped}\n` +
      `  failed  : ${result.failed}\n`,
  );
  if (result.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write((err && err.message ? err.message : String(err)) + "\n");
  process.exit(1);
});
