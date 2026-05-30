#!/usr/bin/env node
/*
 * update-pitch-metrics.mjs
 *
 * Refreshes the live "today" line on the Traction slide of pitch-deck.md with
 * two real numbers:
 *   - registered users  → Stytch Search Users API (results_metadata.total)
 *   - paying engineers   → count of active Stripe subscriptions
 *
 * Then re-exports pitch-deck.html (always) and pitch-deck.pdf (best-effort —
 * PDF needs a headless Chromium that may not exist in every environment).
 *
 * Designed to be run by a daily scheduled Claude Code session, which commits
 * and pushes the result. The script itself only touches files; it does not
 * git commit. See scripts/pitch-metrics-runbook.md.
 *
 * Env (read from the deployment, same names the app already uses):
 *   STYTCH_PROJECT_ID, STYTCH_SECRET   — project-test-* routes to test.stytch.com
 *   STRIPE_SECRET_KEY                  — secret key (sk_live_* / sk_test_*)
 *
 * Flags:
 *   --dry-run   skip API calls + rebuild; update the deck with placeholder
 *               numbers so the edit logic can be exercised offline.
 *   --no-build  update the markdown but skip the marp re-export.
 */

"use strict";

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DECK = join(ROOT, "pitch-deck.md");

const argv = new Set(process.argv.slice(2));
const DRY_RUN = argv.has("--dry-run");
const NO_BUILD = argv.has("--no-build");

// Marker that makes the live line idempotent: every run replaces this one <li>
// rather than appending a new one each day.
const LIVE_MARKER = "<!-- LIVE-METRICS -->";
const LIVE_RE = /<li class="timeline-item"><!-- LIVE-METRICS -->[\s\S]*?<\/li>/;

function fmt(n) {
  return Number(n).toLocaleString("en-US");
}

async function stytchTotalUsers() {
  const projectId = process.env.STYTCH_PROJECT_ID;
  const secret = process.env.STYTCH_SECRET;
  if (!projectId || !secret) {
    throw new Error("STYTCH_PROJECT_ID / STYTCH_SECRET are not set in this environment.");
  }
  const base = projectId.startsWith("project-test-")
    ? "https://test.stytch.com"
    : "https://api.stytch.com";
  const auth = Buffer.from(`${projectId}:${secret}`).toString("base64");
  const res = await fetch(`${base}/v1/users/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    // No query → matches all users; we only care about the total.
    body: JSON.stringify({ limit: 1 }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Stytch ${res.status}: ${data.error_message || data.error_type || "request failed"}`);
  }
  const total = data?.results_metadata?.total;
  if (typeof total !== "number") {
    throw new Error("Stytch response did not include results_metadata.total");
  }
  return total;
}

async function stripeActiveSubscribers() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set in this environment.");
  }
  // Stripe list endpoints don't return a total, so page through active
  // subscriptions and count them. One active subscription = one paying engineer.
  let count = 0;
  let startingAfter = null;
  for (let page = 0; page < 200; page++) {
    const url = new URL("https://api.stripe.com/v1/subscriptions");
    url.searchParams.set("status", "active");
    url.searchParams.set("limit", "100");
    if (startingAfter) url.searchParams.set("starting_after", startingAfter);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Stripe ${res.status}: ${data.error?.message || "request failed"}`);
    }
    count += data.data.length;
    if (!data.has_more) break;
    startingAfter = data.data[data.data.length - 1].id;
  }
  return count;
}

function liveBlock(dateStr, users, payers) {
  const userWord = users === 1 ? "registered user" : "registered users";
  const payWord = payers === 1 ? "paying engineer" : "paying engineers";
  return [
    `<li class="timeline-item">${LIVE_MARKER}`,
    `<span class="timeline-dot"></span>`,
    `<div><p class="timeline-date">${dateStr}</p><p class="timeline-event">${fmt(users)} ${userWord} · ${fmt(payers)} ${payWord} — live today.</p></div>`,
    `</li>`,
  ].join("\n");
}

function updateDeck(dateStr, users, payers) {
  let md = readFileSync(DECK, "utf8");
  const block = liveBlock(dateStr, users, payers);
  if (LIVE_RE.test(md)) {
    md = md.replace(LIVE_RE, block);
  } else {
    // First run: insert the live line right after the "App launched" item.
    const anchor = /(<li class="timeline-item">\s*<span class="timeline-dot"><\/span>\s*<div><p class="timeline-date">May 18, 2026<\/p>[\s\S]*?<\/li>)/;
    if (!anchor.test(md)) {
      throw new Error("Could not find the Traction timeline anchor in pitch-deck.md");
    }
    md = md.replace(anchor, `$1\n${block}`);
  }
  writeFileSync(DECK, md);
}

function rebuild() {
  const themeFlag = `--theme-set pitch-portrait-theme.css --allow-local-files`;
  // HTML never needs Chromium.
  execSync(
    `npx --yes @marp-team/marp-cli@latest pitch-deck.md ${themeFlag} --html -o pitch-deck.html`,
    { cwd: ROOT, stdio: "inherit" },
  );
  // PDF does need Chromium — keep it best-effort so a headless-less environment
  // still gets an up-to-date .md and .html.
  try {
    execSync(
      `npx --yes @marp-team/marp-cli@latest pitch-deck.md ${themeFlag} --pdf -o pitch-deck.pdf`,
      { cwd: ROOT, stdio: "inherit" },
    );
  } catch (e) {
    console.warn(`PDF export skipped (Chromium unavailable?): ${e.message}`);
  }
}

async function main() {
  const dateStr = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  let users;
  let payers;
  if (DRY_RUN) {
    users = 10;
    payers = 1;
    console.log("[dry-run] using placeholder metrics:", { users, payers });
  } else {
    [users, payers] = await Promise.all([stytchTotalUsers(), stripeActiveSubscribers()]);
    console.log(`Stytch registered users: ${users}`);
    console.log(`Stripe active subscribers: ${payers}`);
  }

  updateDeck(dateStr, users, payers);
  console.log(`Updated pitch-deck.md live line → ${dateStr}: ${fmt(users)} users · ${fmt(payers)} paying`);

  if (NO_BUILD || DRY_RUN) {
    console.log("Skipping marp re-export.");
  } else {
    rebuild();
    console.log("Re-exported pitch-deck.html (+ pitch-deck.pdf if Chromium available).");
  }
}

main().catch((err) => {
  console.error(`update-pitch-metrics failed: ${err.message}`);
  process.exit(1);
});
