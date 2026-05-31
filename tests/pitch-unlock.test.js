/* Pitch-button unlock contract.
 *
 * The sidebar's bottom-of-nav "Pitch" button used to be permanently
 * locked (disabled, lock icon, never fired). Until the founder is on a
 * paid monthly plan, pitching happens on beginner instead: the button
 * now carries a link-out (external-link) icon and, on click, opens
 * beginner's /unlock page — the page that describes the Pitch feature
 * and offers the pre-seed ($9/month) subscription.
 *
 * The button opens the canonical production checkout at
 * beginner.work/unlock from every tinker surface. tinker has no custom
 * domain — its own production is served from *.vercel.app — so the URL
 * must NOT be gated on the hostname (an earlier `.vercel.app` check sent
 * production founders to a stale beginner branch-preview alias instead
 * of the live checkout page).
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

test("the unlock URL is the production checkout on every surface", () => {
  assert.match(
    TREE_SRC,
    /https:\/\/beginner\.work\/unlock/,
    "the button opens the canonical beginner.work/unlock",
  );
  // Regression guard: production tinker is itself on *.vercel.app, so the
  // unlock target must not depend on the hostname, and must never carry a
  // hardcoded beginner branch-preview alias (which goes stale the moment
  // its branch merges).
  assert.doesNotMatch(
    TREE_SRC,
    /beginner-git-[\w-]*\.vercel\.app/,
    "the unlock URL must not point at a beginner branch-preview alias",
  );
});
