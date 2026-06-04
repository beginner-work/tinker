#!/usr/bin/env node
/**
 * One-time voice-model upgrade backfill.
 *
 * The personal writing-voice model (api/voice/model.js) is cached per founder
 * under TinkerUserData(userId, "voice-model"), keyed by a signature over their
 * essay corpus. The live route only retrains when that signature changes —
 * i.e. when the founder writes more. So when we *upgrade the analyser model*
 * (the MODEL constant in api/voice/model.js), every existing founder keeps
 * their old profile until they happen to publish again.
 *
 * This script rolls the upgrade across everyone at once: for each founder who
 * has an `essays` blob, it re-trains their voice on the *full current set* of
 * essays using the new model and rewrites the cached "voice-model" row. It
 * reuses api/voice/model.js#trainFromEssays, so the corpus, signature, and
 * profile shape are byte-for-byte what the live route would produce — the
 * refreshed cache reads back as `fresh` on the founder's next visit (no
 * surprise recompute).
 *
 * Idempotent: re-running it just re-trains again. Safe to stop and resume.
 * Founders without enough writing (corpus < MIN_WORDS) are skipped, exactly
 * as the route would skip them.
 *
 * Self-contained — checks its prerequisites and fails loudly with a fix:
 *   DATABASE_URL          required — the Postgres the route reads/writes
 *   ANTHROPIC_API_KEY     required — same server-side key the route uses
 *   (auto-loaded from .env.local / .env if present)
 *
 * Generates the Prisma client on demand if it isn't built yet.
 *
 * Usage:
 *   node scripts/retrain-voice-models.js                 # train everyone
 *   node scripts/retrain-voice-models.js --dry-run       # report, no writes, no API calls
 *   node scripts/retrain-voice-models.js --user <userId> # one founder only
 *   node scripts/retrain-voice-models.js --limit 50      # cap how many we touch
 *   node scripts/retrain-voice-models.js --concurrency 4 # parallel trains (default 3)
 *   node scripts/retrain-voice-models.js --force         # retrain even if already on the new model
 *
 * By default a founder whose cached row is already stamped with the current
 * MODEL is skipped (so a resumed run doesn't pay for work it already did).
 * --force ignores that and retrains unconditionally.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const voice = require("../api/voice/model.js");
const { MODEL, VOICE_KIND, ESSAYS_KIND, trainFromEssays } = voice;

// ── Env loading (mirrors scripts/mint-test-session.js) ──────────────────────
function loadDotEnv() {
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

function parseArgs(argv) {
  const args = { concurrency: 3 };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "--force") args.force = true;
    else if (flag === "--user") args.user = argv[++i];
    else if (flag === "--limit") args.limit = Number(argv[++i]);
    else if (flag === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (flag === "-h" || flag === "--help") args.help = true;
    else {
      console.error(`Unknown argument: ${flag}`);
      args.help = true;
    }
  }
  return args;
}

const HELP = `One-time voice-model upgrade backfill.

Re-trains every founder's cached writing-voice model on their full current
essay corpus using the current analyser model (${MODEL}).

Usage:
  node scripts/retrain-voice-models.js [options]

Options:
  --dry-run            Report who would be trained; no API calls, no writes.
  --user <userId>      Only this founder.
  --limit <n>          Stop after touching n founders.
  --concurrency <n>    Parallel trains (default 3).
  --force              Retrain even if already on ${MODEL}.
  -h, --help           Show this help.

Env (auto-loaded from .env.local / .env):
  DATABASE_URL         required
  ANTHROPIC_API_KEY    required (skip the check with --dry-run)
`;

function ensurePrismaClient() {
  try {
    require.resolve("@prisma/client");
    // Touch the generated client; if generate hasn't run, this throws.
    require("@prisma/client").PrismaClient;
  } catch {
    console.log("Prisma client not found — running `prisma generate`…");
    execSync("npx prisma generate", {
      cwd: path.resolve(__dirname, ".."),
      stdio: "inherit",
    });
  }
}

// Run `worker` over `items` with at most `concurrency` in flight.
async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  const lanes = Array.from({ length: Math.max(1, concurrency) }, run);
  await Promise.all(lanes);
  return results;
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(HELP);
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("✗ DATABASE_URL is not set. Add it to .env.local or the environment.");
    process.exitCode = 1;
    return;
  }
  if (!args.dryRun && !process.env.ANTHROPIC_API_KEY) {
    console.error("✗ ANTHROPIC_API_KEY is not set (needed to train). Use --dry-run to preview.");
    process.exitCode = 1;
    return;
  }

  ensurePrismaClient();
  // Required lazily so the generate step above can run first if needed.
  const prisma = require("../api/_lib/db.js");

  console.log(
    `Voice-model upgrade backfill → ${MODEL}` +
      (args.dryRun ? "  [DRY RUN]" : "") +
      (args.force ? "  [FORCE]" : "")
  );

  // Every founder who has written something. The corpus lives in the `essays`
  // kind; the voice model is derived from it.
  const where = { kind: ESSAYS_KIND };
  if (args.user) where.userId = args.user;
  const essayRows = await prisma.tinkerUserData.findMany({
    where,
    select: { userId: true, data: true },
  });

  // Which founders are already cached on the new model? Skip them unless
  // --force, so a resumed run is cheap.
  const cachedByUser = new Map();
  const voiceRows = await prisma.tinkerUserData.findMany({
    where: args.user ? { kind: VOICE_KIND, userId: args.user } : { kind: VOICE_KIND },
    select: { userId: true, data: true },
  });
  for (const row of voiceRows) cachedByUser.set(row.userId, row.data);

  let candidates = essayRows.map((r) => r.userId);
  if (typeof args.limit === "number" && args.limit >= 0) {
    candidates = candidates.slice(0, args.limit);
  }

  const essaysByUser = new Map(essayRows.map((r) => [r.userId, r.data]));
  const stats = { total: candidates.length, trained: 0, skipped: 0, alreadyCurrent: 0, tooShort: 0, failed: 0 };

  await mapPool(candidates, args.concurrency, async (userId) => {
    const cached = cachedByUser.get(userId);
    if (!args.force && cached && cached.profile && cached.model === MODEL) {
      stats.alreadyCurrent++;
      console.log(`• ${userId}: already on ${MODEL}, skipping`);
      return;
    }

    let result;
    try {
      if (args.dryRun) {
        // No API call in dry-run: report the corpus size the route would use.
        const { __test__ } = voice;
        const pieces = __test__.clampCorpus(__test__.buildCorpus(essaysByUser.get(userId)));
        const wordCount = __test__.corpusWordCount(pieces);
        if (wordCount < __test__.MIN_WORDS) {
          stats.tooShort++;
          console.log(`• ${userId}: ${wordCount} words < MIN_WORDS, would skip`);
        } else {
          console.log(`• ${userId}: would retrain (${pieces.length} essays, ${wordCount} words)`);
        }
        return;
      }

      result = await trainFromEssays(essaysByUser.get(userId));
    } catch (err) {
      stats.failed++;
      console.error(`✗ ${userId}: ${err.message || err}`);
      return;
    }

    if (!result.trained) {
      if (result.reason === "not_enough_writing") {
        stats.tooShort++;
        console.log(`• ${userId}: ${result.wordCount} words < MIN_WORDS, skipped`);
      } else {
        stats.skipped++;
        console.log(`• ${userId}: not trained (${result.reason})`);
      }
      return;
    }

    // result.data already carries the model stamp (set by trainFromEssays),
    // so a resumed run can tell who's already upgraded.
    const data = result.data;
    try {
      await prisma.tinkerUserData.upsert({
        where: { userId_kind: { userId, kind: VOICE_KIND } },
        create: { userId, kind: VOICE_KIND, data },
        update: { data },
      });
      stats.trained++;
      console.log(`✓ ${userId}: retrained (${result.essayCount} essays, ${result.wordCount} words)`);
    } catch (err) {
      stats.failed++;
      console.error(`✗ ${userId}: write failed — ${err.message || err}`);
    }
  });

  console.log("\n── Summary ──");
  console.log(`  founders with essays : ${stats.total}`);
  if (args.dryRun) {
    console.log("  (dry run — no writes, no API calls)");
  } else {
    console.log(`  retrained            : ${stats.trained}`);
    console.log(`  already on ${MODEL}  : ${stats.alreadyCurrent}`);
    console.log(`  too short to model   : ${stats.tooShort}`);
    console.log(`  no usable profile    : ${stats.skipped}`);
    console.log(`  failed               : ${stats.failed}`);
  }

  await prisma.$disconnect().catch(() => {});
  if (stats.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
