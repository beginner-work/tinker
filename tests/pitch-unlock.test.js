/* Pitch-button unlock contract.
 *
 * The sidebar's bottom-of-nav "Pitch" button used to be permanently
 * locked (disabled, never fired). It now ships with a lock icon that is
 * removed on click, and the click opens beginner's /unlock page — the
 * page that describes the Pitch feature and offers the pre-seed
 * ($9/month) subscription.
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

test("clicking Pitch removes the lock icon", () => {
  assert.match(TREE_SRC, /data-pitch-lock/, "the lock icon must be tagged so it can be found/removed");
  // A click handler that removes the lock node from its parent.
  assert.match(
    TREE_SRC,
    /post\.addEventListener\(\s*["']click["']/,
    "the Pitch button must have a click handler",
  );
  assert.match(
    TREE_SRC,
    /removeChild\(lockIcon\)/,
    "clicking Pitch must remove the lock icon",
  );
});

test("clicking Pitch opens beginner's /unlock page", () => {
  assert.match(
    TREE_SRC,
    /https:\/\/beginner\.work\/unlock/,
    "must point at beginner's /unlock page",
  );
  assert.match(
    TREE_SRC,
    /openExternal\(UNLOCK_URL\)/,
    "must open the unlock page via the platform openExternal shim",
  );
});
