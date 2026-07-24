/* Structural contract for the iOS Liquid Glass chrome overlay.
 *
 * Guards the Capacitor plugin + renderer bridge so a refactor can't
 * silently drop the native path back to CSS-only glass on iOS.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const RENDERER = path.join(ROOT, "src", "renderer");
const PLUGIN = path.join(ROOT, "plugins", "tinker-glass-chrome");

const html = fs.readFileSync(path.join(RENDERER, "index.html"), "utf8");
const bridge = fs.readFileSync(path.join(RENDERER, "native-glass-chrome.js"), "utf8");
const drawerCss = fs.readFileSync(path.join(RENDERER, "mobile-drawer.css"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const pluginPkg = JSON.parse(
  fs.readFileSync(path.join(PLUGIN, "package.json"), "utf8"),
);
const overlaySwift = fs.readFileSync(
  path.join(PLUGIN, "ios/Sources/GlassChromePlugin/GlassChromeOverlay.swift"),
  "utf8",
);
const pluginSwift = fs.readFileSync(
  path.join(PLUGIN, "ios/Sources/GlassChromePlugin/GlassChromePlugin.swift"),
  "utf8",
);

test("renderer loads the native glass chrome bridge", () => {
  assert.match(html, /native-glass-chrome\.js/, "bridge script missing from index.html");
});

test("CSS hides web chrome when native overlay is active", () => {
  assert.match(
    drawerCss,
    /html\.native-glass-chrome\s+\.drawer-toggle/,
    "drawer-toggle hide rule missing",
  );
  assert.match(
    drawerCss,
    /html\.native-glass-chrome\s+\.mode-nav/,
    "mode-nav hide rule missing",
  );
});

test("bridge talks to Capacitor GlassChrome on iOS only", () => {
  assert.match(bridge, /GlassChrome/, "plugin name missing");
  assert.match(bridge, /getPlatform\(\)\s*!==\s*"ios"/, "iOS platform guard missing");
  assert.match(bridge, /native-glass-chrome/, "activation class missing");
  assert.match(bridge, /drawerToggle/, "drawer event wiring missing");
  assert.match(bridge, /modeSelect/, "mode event wiring missing");
});

test("local plugin is wired into package.json", () => {
  assert.equal(
    pkg.dependencies["tinker-glass-chrome"],
    "file:plugins/tinker-glass-chrome",
  );
  assert.equal(pluginPkg.capacitor.ios.src, "ios");
});

test("Swift overlay uses Liquid Glass with material fallback", () => {
  assert.match(overlaySwift, /glassEffect/, "glassEffect missing");
  assert.match(overlaySwift, /iOS 26/, "iOS 26 availability missing");
  assert.match(overlaySwift, /ultraThinMaterial/, "material fallback missing");
  assert.match(pluginSwift, /jsName = "GlassChrome"/, "Capacitor jsName mismatch");
  assert.match(pluginSwift, /setModeNav/, "setModeNav missing");
  assert.match(pluginSwift, /setDrawerToggle/, "setDrawerToggle missing");
});
