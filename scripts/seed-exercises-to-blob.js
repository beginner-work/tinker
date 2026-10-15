#!/usr/bin/env node
/* One-time (idempotent) migration: copy checked-in exercise seed files
 * into Vercel Blob as Tinker's source of truth.
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=... node scripts/seed-exercises-to-blob.js
 *
 * Never uploads Formation or other retired curriculum. Safe to re-run;
 * overwrites the same pathnames.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const seedPath = path.join(root, "api/_lib/seeds/exercise-workspace-seed.json");
const blob = require("../api/_lib/exercise-blob.js");
const core = require("../src/renderer/lib/exercise-workspace-core.js");

function loadLocalSeed() {
  const raw = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  return blob.sanitizeSeed(raw);
}

async function main() {
  if (!blob.blobConfigured()) {
    console.error("BLOB_READ_WRITE_TOKEN is missing. Nothing uploaded.");
    process.exit(1);
  }

  const seed = loadLocalSeed();
  const ids = Object.keys(seed.exercises || {});
  for (const id of ids) {
    if (/formation/i.test(id) || core.RETIRED_EXERCISE_IDS.indexOf(id) !== -1) {
      console.error("Refusing to seed retired/Formation exercise:", id);
      process.exit(1);
    }
  }

  console.log("Uploading exercises to Blob:", ids.join(", ") || "(none)");
  const result = await blob.writeSeedWorkspace(seed);
  console.log(JSON.stringify({
    ok: result.ok,
    pathname: result.pathname,
    files: result.files,
    exerciseIds: result.exerciseIds,
  }, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
