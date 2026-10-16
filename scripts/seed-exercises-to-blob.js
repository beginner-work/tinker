#!/usr/bin/env node
/* Idempotent migration: copy checked-in exercise seed files into Vercel
 * Blob as Tinker's source of truth.
 *
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=... node scripts/seed-exercises-to-blob.js
 *   node scripts/seed-exercises-to-blob.js --during-build
 *
 * --during-build (production Vercel build):
 *   Runs only when VERCEL_ENV=production and BLOB_READ_WRITE_TOKEN is set.
 *   Skips quietly otherwise. Blob unreachable → warning, exit 0 (build
 *   must not fail). Formation / retired curriculum still refuse hard.
 *
 * Never uploads Formation or other retired curriculum. Safe to re-run;
 * only missing or changed files are uploaded.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const seedPath = path.join(root, "api/_lib/seeds/exercise-workspace-seed.json");
const blob = require("../api/_lib/exercise-blob.js");
const core = require("../src/renderer/lib/exercise-workspace-core.js");

const duringBuild = process.argv.includes("--during-build");

function loadLocalSeed() {
  const raw = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  return blob.sanitizeSeed(raw);
}

function refuseRetired(ids) {
  for (const id of ids) {
    if (/formation/i.test(id) || core.RETIRED_EXERCISE_IDS.indexOf(id) !== -1) {
      console.error("Refusing to seed retired/Formation exercise:", id);
      process.exit(1);
    }
  }
}

async function main() {
  if (duringBuild) {
    const env = String(process.env.VERCEL_ENV || "").trim();
    if (env !== "production") {
      console.log(
        "[seed-exercises-to-blob] skip: VERCEL_ENV="
          + (env || "(unset)")
          + " (production only during build)"
      );
      return;
    }
    if (!blob.blobConfigured()) {
      console.log(
        "[seed-exercises-to-blob] skip: BLOB_READ_WRITE_TOKEN missing"
      );
      return;
    }
  } else if (!blob.blobConfigured()) {
    console.error("BLOB_READ_WRITE_TOKEN is missing. Nothing uploaded.");
    process.exit(1);
  }

  const seed = loadLocalSeed();
  const ids = Object.keys(seed.exercises || {});
  refuseRetired(ids);

  console.log(
    "[seed-exercises-to-blob] Uploading exercises to Blob:",
    ids.join(", ") || "(none)"
  );

  let result;
  try {
    result = await blob.writeSeedWorkspace(seed);
  } catch (err) {
    if (duringBuild) {
      console.warn(
        "[seed-exercises-to-blob] warning: Blob unreachable or write failed; continuing build.",
        err && err.message ? err.message : err
      );
      return;
    }
    throw err;
  }

  console.log(JSON.stringify({
    ok: result.ok,
    pathname: result.pathname,
    seedUploaded: result.seedUploaded,
    files: result.files,
    filesSkipped: result.filesSkipped,
    exerciseIds: result.exerciseIds,
  }, null, 2));
}

main().catch((err) => {
  if (duringBuild) {
    console.warn(
      "[seed-exercises-to-blob] warning: unexpected error; continuing build.",
      err && err.stack ? err.stack : err
    );
    process.exit(0);
    return;
  }
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
