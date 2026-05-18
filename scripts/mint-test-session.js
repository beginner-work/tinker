#!/usr/bin/env node
/**
 * Mint a long-lived Stytch session token for the test phone number so
 * the dev-bootstrap endpoint has something to seed into localStorage.
 *
 * Stytch's live-project auth is SMS-OTP, so we can't fully automate this
 * without weakening security. The script does the next best thing: it
 * triggers an SMS to TEST_PHONE_NUMBER and prompts you for the 6-digit
 * code at the terminal, then prints the resulting `session_token` and
 * the exact `vercel env add` command to store it.
 *
 * Re-run every ~30 days (Stytch session lifetime) or whenever the token
 * stops working. Set TEST_SESSION_TOKEN in the Preview scope only.
 *
 * Env (auto-loaded from .env.local if present):
 *   STYTCH_PROJECT_ID    required — same as the live preview's project
 *   STYTCH_SECRET        required
 *   TEST_PHONE_NUMBER    required — E.164 or 10-digit US (e.g. 5551234567)
 *
 * Usage:
 *   node scripts/mint-test-session.js
 *   node scripts/mint-test-session.js --phone +15551234567   # override env
 */

"use strict";

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const { sendSmsOtp, authenticateOtp } = require("../api/_lib/stytch.js");

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
    if (flag === "--phone") args.phone = argv[++i];
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
      "Usage: node scripts/mint-test-session.js [--phone <E.164>]",
      "",
      "Env: STYTCH_PROJECT_ID, STYTCH_SECRET, TEST_PHONE_NUMBER",
      "",
      "Triggers an SMS OTP, prompts for the code, prints the resulting",
      "long-lived session_token and the vercel env add command to store it.",
    ].join("\n"),
  );
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  if (!process.env.STYTCH_PROJECT_ID || !process.env.STYTCH_SECRET) {
    console.error("STYTCH_PROJECT_ID and STYTCH_SECRET must be set.");
    console.error("Run `npx vercel env pull` first.");
    process.exit(1);
  }

  const phone = args.phone || process.env.TEST_PHONE_NUMBER;
  if (!phone) {
    console.error("TEST_PHONE_NUMBER env var or --phone arg is required.");
    process.exit(1);
  }

  console.log(`[mint] Triggering SMS OTP to ${phone}...`);
  let send;
  try {
    send = await sendSmsOtp(phone);
  } catch (err) {
    console.error(`[mint] Stytch send failed: ${err.message}`);
    process.exit(1);
  }
  if (!send.phone_id) {
    console.error("[mint] Stytch returned no phone_id.");
    process.exit(1);
  }
  console.log(`[mint] SMS sent. phone_id=${send.phone_id}`);

  const code = await prompt("[mint] Enter the 6-digit code from SMS: ");
  if (!/^\d{6}$/.test(code)) {
    console.error("[mint] That doesn't look like a 6-digit code.");
    process.exit(1);
  }

  let auth;
  try {
    auth = await authenticateOtp(send.phone_id, code);
  } catch (err) {
    console.error(`[mint] Stytch authenticate failed: ${err.message}`);
    process.exit(1);
  }
  if (!auth.session_token) {
    console.error("[mint] Stytch returned no session_token.");
    process.exit(1);
  }

  console.log("");
  console.log("session_token:");
  console.log(`  ${auth.session_token}`);
  console.log("");
  console.log("Store it in the Preview scope only:");
  console.log("");
  console.log("  vercel env rm  TEST_SESSION_TOKEN preview --yes 2>/dev/null || true");
  console.log("  printf '%s' '" + auth.session_token + "' | vercel env add TEST_SESSION_TOKEN preview");
  console.log("");
  console.log("Then redeploy the preview branch so the new token takes effect.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
