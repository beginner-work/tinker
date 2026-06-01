/* Pitch-button destination contract.
 *
 * The sidebar's bottom-of-nav "Pitch" button used to be permanently
 * locked (disabled, lock icon, never fired). Pitching happens on
 * beginner instead: the button now carries a link-out (external-link)
 * icon and, on click, opens the founder's "Back me" page — their
 * profile's QR code (deep-linked to the Back me tab at #share) that
 * backers scan to start the pre-seed ($9/month) subscription.
 *
 * The button opens the canonical production profile at
 * beginner.work/tyler-lindow#share from every tinker surface. tinker has
 * no custom domain — its own production is served from *.vercel.app — so
 * the URL must NOT be gated on the hostname (an earlier `.vercel.app`
 * check sent production founders to a stale beginner branch-preview alias
 * instead of the live page).
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

test("clicking Pitch opens the founder's Back me page", () => {
  assert.match(
    TREE_SRC,
    /post\.addEventListener\(\s*["']click["']/,
    "the Pitch button must have a click handler",
  );
  // Primary path delegates to the shared opener (back-me.js), which decides
  // in-app iframe vs system browser; the inline openExternal is the fallback.
  assert.match(
    TREE_SRC,
    /window\.tinkerBackMe\.open\(\)/,
    "must delegate to the shared Back me opener",
  );
  assert.match(
    TREE_SRC,
    /openExternal\(url\)/,
    "keeps a system-browser fallback if the shared opener didn't load",
  );
});

test("the Back me URL is the production profile QR on every surface", () => {
  // The Back me tab is deep-linked at #share, so the founder lands on the
  // QR view ready to be scanned.
  assert.match(
    TREE_SRC,
    /https:\/\/beginner\.work\/tyler-lindow#share/,
    "the button opens the canonical beginner.work Back me page (#share)",
  );
  // Regression guard: production tinker is itself on *.vercel.app, so the
  // target must not depend on the hostname, and must never carry a
  // hardcoded beginner branch-preview alias (which goes stale the moment
  // its branch merges).
  assert.doesNotMatch(
    TREE_SRC,
    /beginner-git-[\w-]*\.vercel\.app/,
    "the Back me URL must not point at a beginner branch-preview alias",
  );
});

test("the Back me URL carries the tinker session across to beginner", () => {
  // tinker and beginner are different origins, so a founder signed in here
  // has no session there. The button hands the token over in the URL
  // fragment (`#share&ts=<token>`) — the on-device-only channel pwa-session
  // uses — so beginner's profile recognises the owner and shows the QR.
  assert.match(
    TREE_SRC,
    /localStorage\.getItem\("tinker_jwt"\)/,
    "backMeUrl reads the founder's session token",
  );
  assert.match(
    TREE_SRC,
    /\+\s*"&ts="\s*\+\s*encodeURIComponent\(token\)/,
    "the token rides in a `ts` fragment param, URL-encoded",
  );
  // Signed-out (no token) must still produce the bare Back me URL.
  assert.match(
    TREE_SRC,
    /token\s*\?\s*base\s*\+\s*"&ts="/,
    "the token is only appended when the founder is signed in",
  );
});
