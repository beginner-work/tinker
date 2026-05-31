/* Pitch-button unlock contract.
 *
 * The sidebar's bottom-of-nav "Pitch" button used to be permanently
 * locked (disabled, lock icon, never fired). Until the founder is on a
 * paid monthly plan, pitching happens on beginner instead: the button
 * now carries a link-out (external-link) icon and, on click, opens
 * beginner's /unlock page — the page that describes the Pitch feature
 * and offers the pre-seed ($9/month) subscription.
 *
 * On a tinker Vercel preview the button opens the matching beginner
 * branch preview (so the paired PRs can be walked end-to-end); anywhere
 * else it opens the canonical beginner.work.
 *
 * The renderer is browser-shaped and the existing sidebar-tree sandbox
 * uses a no-op DOM that can't observe events, so this is a source-level
 * contract test (same style as the deck/IR regression tests): it pins
 * the moving parts of renderPost so a future edit can't silently
 * re-lock the button or drop the redirect.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const TREE_SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "renderer", "sidebar-tree.js"),
  "utf8",
);

test("the Pitch button is no longer disabled/locked", () => {
  // The old build set `post.disabled = true` and labelled it "(locked)".
  assert.doesNotMatch(
    TREE_SRC,
    /post\.disabled\s*=\s*true/,
    "the Pitch button must not be disabled",
  );
  assert.doesNotMatch(
    TREE_SRC,
    /Pitch \(locked\)/,
    'the aria-label must not say "Pitch (locked)"',
  );
});

test("the Pitch button carries a link-out icon, not a lock", () => {
  assert.match(
    TREE_SRC,
    /data-pitch-linkout/,
    "the button must render the link-out icon",
  );
  assert.doesNotMatch(
    TREE_SRC,
    /data-pitch-lock/,
    "the lock icon must be gone",
  );
});

test("clicking Pitch opens beginner's /unlock page", () => {
  assert.match(
    TREE_SRC,
    /post\.addEventListener\(\s*["']click["']/,
    "the Pitch button must have a click handler",
  );
  assert.match(
    TREE_SRC,
    /openExternal\(url\)/,
    "must open the unlock page via the platform openExternal shim",
  );
});

test("the unlock URL is origin-aware: preview vs production", () => {
  assert.match(
    TREE_SRC,
    /https:\/\/beginner\.work\/unlock/,
    "production opens the canonical beginner.work/unlock",
  );
  assert.match(
    TREE_SRC,
    /\.vercel\.app/,
    "a tinker preview must branch on the *.vercel.app origin",
  );
  assert.match(
    TREE_SRC,
    /beginner-git-claude-stripe-pitch-payment-p-4a2d76-beginner-work\.vercel\.app\/unlock/,
    "a tinker preview must open the matching beginner branch preview",
  );
});
