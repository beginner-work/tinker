/* Guard: /sw.js must not inherit the long-lived asset Cache-Control.
 *
 * Cloudflare was serving a day-cached /sw.js (cf-cache-status HIT) because
 * the generic *.(js|css|…) header rule came after /sw.js no-cache and won.
 * Clients kept tinker-shell-v30 and the old inbox shell.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const offline = fs.readFileSync(path.join(root, "src/renderer/pwa-offline.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const redirect = fs.readFileSync(path.join(root, "src/renderer/repo-redirect.js"), "utf8");
const shell = fs.readFileSync(path.join(root, "src/renderer/messages-shell.js"), "utf8");

function headerSources() {
  return (vercel.headers || []).map((row) => ({
    source: row.source,
    cache:
      (row.headers || []).find((h) => String(h.key).toLowerCase() === "cache-control") ||
      null,
  }));
}

test("long-cache asset rule excludes sw.js; sw.js no-cache is last", () => {
  const rows = headerSources().filter((r) => r.cache);
  const long = rows.find((r) => /max-age=86400/.test(r.cache.value));
  assert.ok(long, "expected long-lived asset Cache-Control rule");
  assert.match(
    long.source,
    /\(\?\!sw/,
    "long-cache source must negative-lookahead-exclude sw.js",
  );
  assert.doesNotMatch(long.source, /^\/sw\.js$/);

  const swIdx = rows.findIndex((r) => r.source === "/sw.js");
  assert.ok(swIdx >= 0, "expected /sw.js header rule");
  assert.match(rows[swIdx].cache.value, /no-cache/);
  assert.match(rows[swIdx].cache.value, /no-store/);
  assert.match(rows[swIdx].cache.value, /must-revalidate/);
  assert.equal(
    swIdx,
    rows.length - 1,
    "/sw.js Cache-Control must be the last header rule so it wins conflicts",
  );

  // HTML shells must not be long-cached either.
  for (const src of ["/", "/index.html", "/repo", "/repo/", "/repo/index.html"]) {
    const row = rows.find((r) => r.source === src);
    assert.ok(row, `expected Cache-Control for ${src}`);
    assert.match(row.cache.value, /no-cache/);
    assert.match(row.cache.value, /no-store/);
  }
});

test("service worker registers a versioned URL matching CACHE_VERSION", () => {
  const ver = sw.match(/CACHE_VERSION\s*=\s*["']tinker-shell-v(\d+)["']/);
  assert.ok(ver, "CACHE_VERSION missing");
  assert.equal(ver[1], "44");
  assert.match(offline, new RegExp(`register\\(\\s*SW_URL|register\\(\\s*["']/sw\\.js\\?v=${ver[1]}["']`));
  assert.match(offline, new RegExp(`/sw\\.js\\?v=${ver[1]}`));
  assert.match(offline, /skipWaiting|SKIP_WAITING/);
  assert.match(offline, /controllerchange/);
  assert.match(offline, /location\.reload/);
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /clients\.claim/);
  assert.match(html, /pwa-offline\.js\?v=44/);

  const swRule = (vercel.headers || []).find((row) => row.source === "/sw.js");
  const keys = (swRule.headers || []).map((h) => h.key);
  assert.ok(keys.includes("CDN-Cache-Control"), "CDN-Cache-Control tells Cloudflare not to store /sw.js");
  assert.ok(keys.includes("Cloudflare-CDN-Cache-Control"));
});

test("signed-in / redirects to /repo unless write=1", () => {
  assert.match(html, /repo-redirect\.js\?v=40/);
  assert.match(redirect, /tinker_jwt/);
  assert.match(redirect, /write=1/);
  assert.match(redirect, /location\.replace\(\s*["']\/repo["']\s*\)/);
  assert.match(shell, /goRepoHome|\/repo/);
  assert.match(shell, /wantsWriteSurface|write=1/);
  // Hunt / inbox chrome must not be the live landing UI.
  assert.doesNotMatch(html, /sidebar--inbox/);
  assert.match(html, /sidebar--write/);
  assert.match(html, /id="sidebar-funnel"[^>]*hidden/);
});
