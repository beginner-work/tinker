#!/usr/bin/env node
/* Export the owner career record via GET /api/career?action=export.
 *
 * Auth: Authorization: Bearer $CAREER_EXPORT_TOKEN
 * Writes career-export-YYYY-MM-DD.json under an output directory.
 * Exits non-zero on any non-200 response or empty record.
 *
 * Bearer exports resolve the owner as the first entry in
 * LEADS_OWNER_ALLOWLIST on the server (same allowlist the Stytch
 * owner check uses).
 *
 * Usage:
 *   CAREER_EXPORT_TOKEN=... node scripts/career-export.js --out ./backups
 *   CAREER_EXPORT_TOKEN=... node scripts/career-export.js --out ./backups \
 *     --base-url https://tinker.beginner.work
 */

"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_BASE = "https://tinker.beginner.work";

function readArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] || null;
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function isEmptyRecord(record) {
  if (record == null) return true;
  if (typeof record !== "object" || Array.isArray(record)) return true;
  return false;
}

async function main() {
  const token = String(process.env.CAREER_EXPORT_TOKEN || "").trim();
  if (!token) throw new Error("CAREER_EXPORT_TOKEN is required.");

  const outDir = readArg("--out");
  if (!outDir) throw new Error("Pass --out <directory>.");

  const base = String(
    readArg("--base-url") || process.env.TINKER_BASE_URL || DEFAULT_BASE,
  ).replace(/\/$/, "");
  const url = base + "/api/career?action=export";

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/json",
    },
  });

  if (response.status !== 200) {
    let detail = "";
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      detail = "";
    }
    throw new Error(
      "Export failed with HTTP " + response.status + (detail ? ": " + detail : ""),
    );
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("Export response was not JSON.");
  }

  if (!body || isEmptyRecord(body.record)) {
    throw new Error("Export returned an empty record.");
  }

  const dir = path.resolve(outDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "career-export-" + todayStamp() + ".json");
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n", "utf8");
  process.stdout.write(file + "\n");
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
