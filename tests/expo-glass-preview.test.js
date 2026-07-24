/* Structural guard for the Expo Go Liquid Glass preview app. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MOBILE = path.join(__dirname, "..", "mobile");

test("Expo preview app is present with glass-effect dependency", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(MOBILE, "package.json"), "utf8"),
  );
  assert.ok(
    pkg.dependencies["expo-glass-effect"],
    "expo-glass-effect missing from mobile/package.json",
  );
  assert.ok(pkg.dependencies.expo, "expo missing");
});

test("App mounts glass chrome components", () => {
  const app = fs.readFileSync(path.join(MOBILE, "App.tsx"), "utf8");
  assert.match(app, /DrawerToggle/, "DrawerToggle missing");
  assert.match(app, /ModeNav/, "ModeNav missing");
  assert.match(app, /expo-glass-effect/, "glass-effect import missing");

  const glass = fs.readFileSync(
    path.join(MOBILE, "src/components/TinkerGlass.tsx"),
    "utf8",
  );
  assert.match(glass, /GlassView/, "GlassView wrapper missing");
  assert.match(glass, /isLiquidGlassAvailable/, "availability check missing");
});

test("Expo app.json is named tinker", () => {
  const appJson = JSON.parse(
    fs.readFileSync(path.join(MOBILE, "app.json"), "utf8"),
  );
  assert.equal(appJson.expo.name, "tinker");
  assert.equal(appJson.expo.slug, "tinker");
});
