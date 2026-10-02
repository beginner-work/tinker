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

const { EXPECTED_SW_CACHE_VERSION, swSource: sw } = require("./helpers/sw-cache-version.js");

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
  // Single format + value assertion for CACHE_VERSION (satellites must not pin vNN).
  assert.match(
    sw,
    /CACHE_VERSION\s*=\s*["']tinker-shell-v\d+["']/,
    "CACHE_VERSION is missing or malformed",
  );
  assert.equal(
    EXPECTED_SW_CACHE_VERSION,
    sw.match(/CACHE_VERSION\s*=\s*["'](tinker-shell-v\d+)["']/)[1],
    "helpers/sw-cache-version.js must track sw.js",
  );
});

test("CSS and JS use network-first so deployed PWAs pick up new shell assets", () => {
  assert.match(sw, /networkFirstAsset/, "missing network-first asset helper");
  assert.match(sw, /isShellAssetPath/, "missing CSS/JS shell asset gate");
  assert.match(sw, /\.css/, "CSS must be treated as a shell asset path");
  assert.match(sw, /staleWhileRevalidate/, "icons/tokens still use SWR");
  const fetchHandler = sw.slice(sw.indexOf('addEventListener("fetch"'));
  // Shell CSS/JS gate must call networkFirstAsset before any other strategy.
  assert.match(
    fetchHandler,
    /if\s*\(\s*isShellAssetPath\([^)]*\)\s*\)\s*\{[^}]*networkFirstAsset/,
    "fetch handler must route CSS/JS through network-first",
  );
  assert.equal(
    /if\s*\(\s*isShellAssetPath\([^)]*\)\s*\)\s*\{[^}]*staleWhileRevalidate/.test(fetchHandler),
    false,
    "CSS/JS must not use stale-while-revalidate (strands installed PWAs)",
  );
  assert.match(sw, /\/profile\.css/, "profile.css must be precached");
  assert.match(sw, /\/messages-shell\.js/, "messages shell must be precached");
  assert.match(sw, /\/messages-notepad\.js/, "messages notepad must be precached");
  assert.match(sw, /\/messages-composer\.js/, "messages composer must be precached");
  assert.match(sw, /\/messages-reading\.js/, "messages reading must be precached");
  assert.match(sw, /\/messages-thread-actions\.js/, "shared thread actions must be precached");
  assert.match(sw, /\/platform-mobile\.js/, "platform-mobile must be precached");
});

test("new service workers claim clients and can skip waiting on message", () => {
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /clients\.claim/);
  assert.match(sw, /SKIP_WAITING/);
  const offline = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "pwa-offline.js"),
    "utf8",
  );
  assert.match(offline, /controllerchange/);
  assert.match(offline, /location\.reload/);
});
