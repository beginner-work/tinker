#!/usr/bin/env node
/**
 * Local CLI for the preview smoke runner.
 *
 * Lets you iterate on scenario logic against a real Vercel preview URL
 * without pushing through CI. The actual smoke logic lives in
 * api/_lib/preview-smoke.js (shared with the Vercel function handler).
 *
 * Env (mostly auto-loaded from .env.local after `vercel env pull`):
 *   PREVIEW_URL            — preview URL to drive Browserbase at
 *   BROWSERBASE_API_KEY    — from Vercel project env
 *   BROWSERBASE_PROJECT_ID — from Vercel project env
 *
 *   PR_NUMBER, GITHUB_TOKEN, GITHUB_REPOSITORY, HEAD_SHA — only needed
 *     if you want to actually post the comment. Omit them to run in
 *     "dry" mode that just prints the rendered comment body.
 *
 *   SCREENSHOTS_DIR — where to write per-scenario PNGs (default: ./tmp/preview-screenshots)
 *
 * Args:
 *   --url <preview-url>   Overrides PREVIEW_URL.
 *   --pr <number>         Overrides PR_NUMBER.
 *   --dry-run             Force dry mode (don't post comment).
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  loadScenarios,
  runPreviewSmoke,
  renderComment,
  upsertComment,
} = require("../api/_lib/preview-smoke.js");

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
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--url") args.url = argv[++i];
    else if (flag === "--pr") args.pr = argv[++i];
    else if (flag === "--dry-run") args.dryRun = true;
    else if (flag === "-h" || flag === "--help") args.help = true;
    else {
      console.error(`Unknown argument: ${flag}`);
      process.exit(1);
    }
  }
  return args;
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log("Usage: node scripts/run-preview-smoke.js [--url URL] [--pr N] [--dry-run]");
    return;
  }

  const previewUrl = args.url || process.env.PREVIEW_URL;
  const bbApiKey = process.env.BROWSERBASE_API_KEY;
  const bbProjectId = process.env.BROWSERBASE_PROJECT_ID;
  const prNumber = args.pr || process.env.PR_NUMBER;
  const githubToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.HEAD_SHA || "local";
  const screenshotsDir =
    process.env.SCREENSHOTS_DIR ||
    path.join(os.tmpdir(), "preview-screenshots");

  const missing = [];
  if (!previewUrl) missing.push("PREVIEW_URL (or --url)");
  if (!bbApiKey) missing.push("BROWSERBASE_API_KEY");
  if (!bbProjectId) missing.push("BROWSERBASE_PROJECT_ID");
  if (missing.length) {
    console.error(`Missing required env: ${missing.join(", ")}`);
    process.exit(1);
  }

  const scenariosPath = path.resolve(
    __dirname,
    "..",
    "tests",
    "preview",
    "scenarios.json",
  );
  const scenarios = loadScenarios(scenariosPath);
  if (scenarios.length === 0) {
    console.log(`[smoke] No scenarios at ${scenariosPath}; nothing to do.`);
    return;
  }
  console.log(`[smoke] ${scenarios.length} scenario(s) against ${previewUrl}`);

  const { sessionId, results } = await runPreviewSmoke({
    previewUrl,
    scenarios,
    bbApiKey,
    bbProjectId,
    screenshotsDir,
  });
  console.log(`[smoke] session ${sessionId} done; screenshots -> ${screenshotsDir}`);
  for (const r of results) {
    console.log(`[smoke]   ${r.ok ? "PASS" : "FAIL"}: ${r.name} — ${r.detail}`);
  }

  const body = renderComment({ results, previewUrl, sha });

  const canPost = !args.dryRun && prNumber && githubToken && repo;
  if (!canPost) {
    console.log("\n--- DRY MODE: comment body ---\n");
    console.log(body);
    return;
  }

  const upsert = await upsertComment({
    repo,
    prNumber,
    body,
    token: githubToken,
  });
  console.log(`[smoke] Comment ${upsert.action} (id=${upsert.id})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
