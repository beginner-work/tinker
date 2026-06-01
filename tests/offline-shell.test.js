/* Regression guard for the offline app-shell service worker (sw.js).
 *
 * This is a structural source-parse test in the same spirit as
 * welcome-shell.test.js — it asserts the load-bearing freshness wiring
 * is present, not runtime behaviour.
 *
 * It exists because of a real, user-visible freeze: navigations to the
 * root request "/", and the offline fallback matches that cache entry
 * first — but networkFirstDoc only ever refreshed "/index.html". The "/"
 * entry was therefore frozen at the bytes precached when the current
 * CACHE_VERSION was introduced. When the welcome screen later changed
 * (the location-grid "You are a founder." rewrite), installed PWAs that
 * had registered the old version kept serving the stale "Everyone is a
 * founder" shell offline, indefinitely, because nothing ever rewrote the
 * "/" entry. The fix refreshes both canonical keys in lockstep; this
 * test fails if a future change drops that.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sw = fs.readFileSync(
  path.join(__dirname, "..", "src", "renderer", "sw.js"),
  "utf8",
);

test("a fresh navigation refreshes both canonical shell keys", () => {
  // Updating only /index.html strands the "/" entry that root
  // navigations match first; both must be rewritten on every fresh fetch.
  assert.match(
    sw,
    /cache\.put\(\s*["']\/["']\s*,/,
    'networkFirstDoc must refresh the "/" cache entry, not just /index.html',
  );
  assert.match(
    sw,
    /cache\.put\(\s*["']\/index\.html["']\s*,/,
    "networkFirstDoc must keep refreshing the /index.html cache entry",
  );
});

test("the activate handler evicts stale caches", () => {
  // A bumped CACHE_VERSION only helps if old versions are deleted.
  assert.match(
    sw,
    /caches\.delete/,
    "activate handler no longer evicts old cache versions",
  );
  assert.match(
    sw,
    /CACHE_VERSION\s*=\s*["']tinker-shell-v\d+["']/,
    "CACHE_VERSION is missing or malformed",
  );
});
