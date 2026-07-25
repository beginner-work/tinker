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
  assert.ok(
    pkg.dependencies["react-native-safe-area-context"],
    "react-native-safe-area-context missing",
  );
});

test("App mounts glass chrome components", () => {
  const app = fs.readFileSync(path.join(MOBILE, "App.tsx"), "utf8");
  assert.match(app, /DrawerToggle/, "DrawerToggle missing");
  assert.match(app, /ModeNav/, "ModeNav missing");
  assert.match(app, /useLiquidGlassAvailability/, "availability hook missing");
  assert.match(app, /SafeAreaProvider/, "SafeAreaProvider missing");

  const glass = fs.readFileSync(
    path.join(MOBILE, "src/components/TinkerGlass.tsx"),
    "utf8",
  );
  assert.match(glass, /GlassView/, "GlassView wrapper missing");
  assert.match(glass, /GlassContainer/, "GlassContainer wrapper missing");
  assert.match(glass, /isLiquidGlassAvailable/, "availability check missing");
  assert.match(glass, /isGlassEffectAPIAvailable/, "API check missing");
  assert.match(
    glass,
    /isReduceTransparencyEnabled/,
    "Reduce Transparency a11y check missing",
  );
});

test("Welcome place cards use TinkerGlass", () => {
  const welcome = fs.readFileSync(
    path.join(MOBILE, "src/components/WelcomeBody.tsx"),
    "utf8",
  );
  assert.match(welcome, /TinkerGlass/, "place cards missing TinkerGlass");
  assert.match(welcome, /TinkerGlassGroup/, "place grid missing GlassContainer group");
});

test("Sidebar drawer uses glass sheet", () => {
  const drawer = fs.readFileSync(
    path.join(MOBILE, "src/components/SidebarDrawer.tsx"),
    "utf8",
  );
  assert.match(drawer, /TinkerGlass/, "sidebar missing TinkerGlass");
  assert.match(drawer, /shape=\"sheet\"/, "sidebar should use sheet shape");
});

test("Expo app.json is named tinker", () => {
  const appJson = JSON.parse(
    fs.readFileSync(path.join(MOBILE, "app.json"), "utf8"),
  );
  assert.equal(appJson.expo.name, "tinker");
  assert.equal(appJson.expo.slug, "tinker");
});

test("EAS publish scripts are wired", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(MOBILE, "package.json"), "utf8"),
  );
  assert.ok(pkg.scripts["publish:preview"], "publish:preview missing");
  assert.ok(pkg.scripts["deploy:web"], "deploy:web missing");
  assert.ok(pkg.scripts["build:dev"], "build:dev missing");
  assert.ok(
    pkg.dependencies["expo-dev-client"],
    "expo-dev-client missing from dependencies",
  );
  assert.ok(
    fs.existsSync(path.join(MOBILE, "eas.json")),
    "eas.json missing",
  );
  const eas = JSON.parse(
    fs.readFileSync(path.join(MOBILE, "eas.json"), "utf8"),
  );
  assert.ok(
    eas.build?.development?.developmentClient,
    "development profile must set developmentClient",
  );
  assert.equal(
    eas.build?.development?.ios?.simulator,
    true,
    "development profile must target iOS Simulator (iPhone 17 Pro)",
  );
});
