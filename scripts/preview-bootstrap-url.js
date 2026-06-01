#!/usr/bin/env node
/**
 * Build the one-shot `/api/dev-bootstrap` URL that signs you into a Vercel
 * preview as your *real* Live Stytch user — without sending a new SMS.
 *
 * Why this exists: preview shares the production Stytch project and the
 * production Postgres, so a preview is "a second URL pointing at production"
 * (see README → "Set the same values for Production and Preview"). But every
 * preview deploy gets a fresh `*.vercel.app` origin with empty localStorage,
 * so the SMS-OTP gate makes you sign in again on each one. Re-signing-in burns
 * a Stytch SMS send, and after ~24 sends in 24h Stytch rate-limits your number.
 *
 * The fix is to stop re-sending codes: mint one long-lived session_token from
 * your real phone *once* (see `scripts/mint-test-session.js`, ~every 30 days),
 * then seed it into each new preview origin via `/api/dev-bootstrap` instead of
 * re-running the OTP. This script just prints that ready-to-open URL. Opening
 * it in your own browser lands you in the preview authenticated as your real
 * production account, reading and writing real production data, with zero SMS.
 *
 * Env (auto-loaded from .env.local if present; `npx vercel env pull` first):
 *   TEST_AUTH_TOKEN                  required — gates /api/dev-bootstrap
 *   VERCEL_AUTOMATION_BYPASS_SECRET  optional — needed only if the preview has
 *                                    Deployment Protection enabled; when set,
 *                                    the URL also clears Vercel's edge auth wall
 *
 * Usage:
 *   node scripts/preview-bootstrap-url.js --url https://tinker-abc.vercel.app
 *   node scripts/preview-bootstrap-url.js --url https://tinker-abc.vercel.app --next /daily/
 */

"use strict";

const fs = require("fs");
const path = require("path");

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
  const args = { next: "/" };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--url") args.url = argv[++i];
    else if (flag === "--next") args.next = argv[++i];
    else if (flag === "-h" || flag === "--help") args.help = true;
    else {
      console.error(`Unknown argument: ${flag}`);
      process.exit(1);
    }
  }
  return args;
}

function printHelp() {
  console.log(
    [
      "Usage: node scripts/preview-bootstrap-url.js --url <previewBase> [--next <path>]",
      "",
      "Env: TEST_AUTH_TOKEN (required), VERCEL_AUTOMATION_BYPASS_SECRET (optional)",
      "",
      "Prints the /api/dev-bootstrap URL that seeds your real Live Stytch session",
      "into the preview's localStorage — sign in as your production account with",
      "no new SMS. Run `npx vercel env pull` first to populate the env.",
    ].join("\n"),
  );
}

function main() {
  loadDotEnv();
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.url) {
    console.error("--url <previewBase> is required, e.g. https://tinker-abc.vercel.app");
    process.exit(1);
  }

  let base;
  try {
    base = new URL(args.url);
  } catch {
    console.error(`Not a valid URL: ${args.url}`);
    process.exit(1);
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    console.error("--url must be an http(s) URL.");
    process.exit(1);
  }

  const testAuth = process.env.TEST_AUTH_TOKEN;
  if (!testAuth) {
    console.error("TEST_AUTH_TOKEN is not set. Run `npx vercel env pull` first.");
    process.exit(1);
  }

  // safeNext mirrors api/dev-bootstrap.js: only same-origin absolute paths.
  let next = typeof args.next === "string" ? args.next : "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.includes(":") || next.length > 200) {
    console.error(`Refusing unsafe --next "${args.next}"; the server would ignore it. Use a path like /daily/.`);
    process.exit(1);
  }

  const out = new URL("/api/dev-bootstrap", base.origin);
  out.searchParams.set("test_auth", testAuth);

  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) {
    // Vercel consumes these at the edge before the function runs, and sets a
    // _vercel_jwt cookie so later navigations on the same browser don't need
    // them. Only relevant when the preview has Deployment Protection on.
    out.searchParams.set("x-vercel-protection-bypass", bypass);
    out.searchParams.set("x-vercel-set-bypass-cookie", "true");
  }
  out.searchParams.set("next", next);

  console.log(out.toString());
  if (!bypass) {
    console.error(
      "\n(note: VERCEL_AUTOMATION_BYPASS_SECRET not set — if this preview has " +
        "Deployment Protection enabled, you'll hit Vercel's auth wall first.)",
    );
  }
}

main();
