/* UI-contract regression guard for the native-mobile reskin.
 *
 * The shell must read as a phone app (solid top bar, docked bottom
 * chrome, drawer scrim) while keeping tinker tokens — cream paper,
 * Fraunces, no Cursor dark.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RENDERER = path.join(__dirname, "..", "src", "renderer");
const html = fs.readFileSync(path.join(RENDERER, "index.html"), "utf8");
const nativeCss = fs.readFileSync(path.join(RENDERER, "native-mobile.css"), "utf8");
const manifest = fs.readFileSync(path.join(RENDERER, "manifest.json"), "utf8");
const sw = fs.readFileSync(path.join(RENDERER, "sw.js"), "utf8");

test("native top bar and stylesheet are wired", () => {
  assert.match(html, /id="native-topbar"/, "native-topbar mount missing");
  assert.match(html, /data-native-title/, "native title slot missing");
  assert.match(html, /native-mobile\.css/, "native-mobile.css not linked");
  assert.match(
    html,
    /apple-mobile-web-app-status-bar-style"\s+content="black-translucent"/,
    "status-bar-style must be black-translucent for cream under the notch"
  );
  assert.match(
    html,
    /theme-color"\s+content="#fffdf7"/,
    "theme-color must match tinker paper"
  );
});

test("native-mobile.css loads after profile.css so top-bar wins", () => {
  const profileIdx = html.indexOf("profile.css");
  const nativeIdx = html.indexOf("native-mobile.css");
  assert.ok(profileIdx >= 0 && nativeIdx > profileIdx,
    "native-mobile.css must load after profile.css");
});

test("manifest theme matches tinker paper", () => {
  assert.match(manifest, /"theme_color":\s*"#fffdf7"/);
  assert.match(manifest, /"background_color":\s*"#fffdf7"/);
});

test("native shell keeps tinker tokens and avoids Cursor dark", () => {
  assert.match(nativeCss, /--color-background/, "must use tinker background token");
  assert.match(nativeCss, /--font-display/, "must use Fraunces display token");
  assert.match(nativeCss, /\.native-topbar/, "top app bar styles missing");
  assert.match(nativeCss, /mode-nav__bar/, "docked bottom chrome missing");
  assert.doesNotMatch(
    nativeCss,
    /#0d1117|#141210|#1a1a1a/,
    "native shell must not use Cursor/GitHub dark backgrounds"
  );
});

test("service worker precaches native-mobile.css", () => {
  assert.match(sw, /\/native-mobile\.css/, "sw.js PRECACHE missing native-mobile.css");
  assert.match(sw, /CACHE_VERSION\s*=\s*"tinker-shell-v6"/);
});
