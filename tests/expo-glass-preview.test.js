/* Structural guard for the Expo native Liquid Glass + screens app. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MOBILE = path.join(__dirname, "..", "mobile");
const APP = path.join(MOBILE, "app");

test("Expo app is present with glass-effect + router", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(MOBILE, "package.json"), "utf8"),
  );
  assert.ok(pkg.dependencies["expo-glass-effect"], "expo-glass-effect missing");
  assert.ok(pkg.dependencies["expo-router"], "expo-router missing");
  assert.ok(pkg.dependencies["expo-secure-store"], "expo-secure-store missing");
  assert.ok(pkg.dependencies["expo-dev-client"], "expo-dev-client missing");
  assert.equal(pkg.main, "expo-router/entry");
});

test("Native screens are mounted under app/", () => {
  const required = [
    "_layout.tsx",
    "index.tsx",
    "sign-in.tsx",
    "write.tsx",
    "freewrite.tsx",
    "read.tsx",
    "assessing.tsx",
    "essays.tsx",
    "pitch-script.tsx",
    "founders.tsx",
    "profile.tsx",
    "connect-repo.tsx",
  ];
  for (const file of required) {
    assert.ok(
      fs.existsSync(path.join(APP, file)),
      `missing app/${file}`,
    );
  }
});

test("GitHub repo is required before writing and essays open PRs", () => {
  const github = fs.readFileSync(
    path.join(MOBILE, "src/lib/github.ts"),
    "utf8",
  );
  assert.match(github, /createEssayPullRequest/);
  assert.match(github, /connectGitHubRepo/);
  assert.match(github, /tinker_github_token_v1/);

  const drafts = fs.readFileSync(
    path.join(MOBILE, "src/lib/drafts.ts"),
    "utf8",
  );
  assert.match(drafts, /publishEssayWithPullRequest/);
  assert.match(drafts, /retryEssayPullRequest/);

  const index = fs.readFileSync(path.join(APP, "index.tsx"), "utf8");
  assert.match(index, /isGitHubConnected/);
  assert.match(index, /connect-repo/);

  const write = fs.readFileSync(path.join(APP, "write.tsx"), "utf8");
  assert.match(write, /isGitHubConnected/);
  assert.match(write, /publishEssayWithPullRequest/);

  const freewrite = fs.readFileSync(path.join(APP, "freewrite.tsx"), "utf8");
  assert.match(freewrite, /isGitHubConnected/);
  assert.match(freewrite, /publishEssayWithPullRequest/);

  const assessing = fs.readFileSync(path.join(APP, "assessing.tsx"), "utf8");
  assert.match(assessing, /Open PR/);
  assert.match(assessing, /retryEssayPullRequest/);
});

test("Glass chrome + interview engine present", () => {
  const glass = fs.readFileSync(
    path.join(MOBILE, "src/components/TinkerGlass.tsx"),
    "utf8",
  );
  assert.match(glass, /GlassView/);
  assert.match(glass, /GlassContainer/);
  assert.match(glass, /isReduceTransparencyEnabled/);

  const interview = fs.readFileSync(
    path.join(MOBILE, "src/lib/interview.ts"),
    "utf8",
  );
  assert.match(interview, /STITCH, DO NOT AUTHOR/);
  assert.match(interview, /verifyFounderOnly/);

  const chrome = fs.readFileSync(
    path.join(MOBILE, "src/components/AppChrome.tsx"),
    "utf8",
  );
  assert.match(chrome, /DrawerToggle/);
  assert.match(chrome, /ModeNav/);
});

test("Expo app.json is named tinker with apiBase", () => {
  const appJson = JSON.parse(
    fs.readFileSync(path.join(MOBILE, "app.json"), "utf8"),
  );
  assert.equal(appJson.expo.name, "tinker");
  assert.equal(appJson.expo.slug, "tinker");
  assert.ok(appJson.expo.extra?.apiBase, "apiBase missing");
  assert.ok(
    appJson.expo.plugins.includes("expo-router"),
    "expo-router plugin missing",
  );
});

test("EAS development targets iOS Simulator", () => {
  const eas = JSON.parse(
    fs.readFileSync(path.join(MOBILE, "eas.json"), "utf8"),
  );
  assert.ok(eas.build?.development?.developmentClient);
  assert.equal(eas.build?.development?.ios?.simulator, true);
  assert.equal(eas.build?.simulator?.ios?.simulator, true);
  assert.ok(!eas.build?.simulator?.developmentClient);
});
