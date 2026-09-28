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
  assert.match(glass, /readReduceTransparency/);
  assert.match(glass, /typeof fn !== "function"/);

  const interview = fs.readFileSync(
    path.join(MOBILE, "src/lib/interview.ts"),
    "utf8",
  );
  assert.match(interview, /STITCH, DO NOT AUTHOR/);
  assert.match(interview, /verifyFounderOnly/);
  assert.match(interview, /RULE 8 — TRANSACTIONS AS A MIRROR/);
  assert.match(interview, /RULE 10 — ASK IN THE FOUNDER'S OWN WRITING VOICE/);

  const chrome = fs.readFileSync(
    path.join(MOBILE, "src/components/AppChrome.tsx"),
    "utf8",
  );
  assert.match(chrome, /DrawerToggle/);
  assert.match(chrome, /ModeNav/);
});

test("Expo app.json is named tinker with production apiBase", () => {
  const appJson = JSON.parse(
    fs.readFileSync(path.join(MOBILE, "app.json"), "utf8"),
  );
  assert.equal(appJson.expo.name, "tinker");
  assert.equal(appJson.expo.slug, "tinker");
  assert.equal(appJson.expo.ios?.bundleIdentifier, "co.tinker.expo");
  assert.equal(
    appJson.expo.extra?.apiBase,
    "https://tinker.beginner.work",
  );
  assert.ok(
    appJson.expo.plugins.includes("expo-router"),
    "expo-router plugin missing",
  );
  assert.ok(appJson.expo.updates?.url, "EAS Update URL missing");
});

test("Welcome chrome does not steal taps from place cards", () => {
  const welcome = fs.readFileSync(
    path.join(MOBILE, "src/components/WelcomeBody.tsx"),
    "utf8",
  );
  assert.match(welcome, /pointerEvents="none"/);
  assert.match(welcome, /onPickPlace/);
  assert.match(welcome, /You just need a seed to start\./);
  assert.match(welcome, /Where are you right now\?/);
  assert.match(welcome, /Where are you\?/);
  assert.match(welcome, /Start →/);
  assert.doesNotMatch(welcome, /Pick a place to start writing/);
  assert.doesNotMatch(welcome, /guided interview/);

  const index = fs.readFileSync(path.join(APP, "index.tsx"), "utf8");
  // Gate on falsy signedIn (null hydrating OR false) — never race past auth.
  assert.match(index, /if \(!signedIn\)/);
});

test("Mobile product copy matches the web renderer", () => {
  const signIn = fs.readFileSync(path.join(APP, "sign-in.tsx"), "utf8");
  assert.match(signIn, /Sign in to tinker/);
  assert.match(signIn, /Enter your phone — we'll text you a six-digit code\./);
  assert.match(signIn, /Enter your code/);
  assert.match(signIn, /The code expires in 10 minutes\./);
  assert.match(signIn, /\(555\) 000-0000/);
  assert.match(signIn, /Verify/);
  assert.match(signIn, /← Use a different number/);
  assert.match(
    signIn,
    /Sign-up and login share this screen — first-time users get an/,
  );

  const freewrite = fs.readFileSync(path.join(APP, "freewrite.tsx"), "utf8");
  assert.match(freewrite, /What are you learning\?/);
  assert.match(freewrite, /Type your answer in your own words…/);
  assert.match(freewrite, /This is everything →/);
  assert.match(freewrite, /Saved on this device\./);

  const assessing = fs.readFileSync(path.join(APP, "assessing.tsx"), "utf8");
  assert.match(assessing, /You created another essay/);
  assert.match(assessing, /Your pitch is being assessed\./);
  assert.match(assessing, /Keep writing →/);
  assert.match(assessing, /Re-read your essay/);

  const founders = fs.readFileSync(path.join(APP, "founders.tsx"), "utf8");
  assert.match(founders, /styles\.title\}>founders</);
  assert.match(founders, /find my founders/);
  assert.match(founders, /Founders adjacent to you/);
  assert.match(founders, /You're early — there aren't enough founders here yet/);

  const pitch = fs.readFileSync(path.join(APP, "pitch-script.tsx"), "utf8");
  assert.match(pitch, /Prepare a script for a video/);
  assert.match(pitch, /Copy script/);
  assert.match(
    pitch,
    /This pitch doesn't have any resolved phrases yet/,
  );

  const essays = fs.readFileSync(path.join(APP, "essays.tsx"), "utf8");
  assert.match(essays, /No essays here yet\./);

  const write = fs.readFileSync(path.join(APP, "write.tsx"), "utf8");
  assert.match(write, /Setting the scene…/);
  assert.match(write, /Stitching your essay…/);
  assert.match(write, /Something went wrong\./);
  assert.match(write, /Try again/);

  const interview = fs.readFileSync(
    path.join(MOBILE, "src/lib/interview.ts"),
    "utf8",
  );
  assert.match(interview, /RULE 8 — TRANSACTIONS AS A MIRROR/);
  assert.match(interview, /RULE 9 — STEER TOWARD UNEXPLORED PITCH TERRITORY/);
  assert.match(interview, /RULE 10 — ASK IN THE FOUNDER'S OWN WRITING VOICE/);

  const drawer = fs.readFileSync(
    path.join(MOBILE, "src/components/SidebarDrawer.tsx"),
    "utf8",
  );
  assert.match(drawer, /© 2026 tinker/);
  assert.doesNotMatch(drawer, /Liquid Glass chrome/);
});

test("EAS is configured as the iOS release manager", () => {
  const eas = JSON.parse(
    fs.readFileSync(path.join(MOBILE, "eas.json"), "utf8"),
  );
  assert.ok(eas.build?.development?.developmentClient);
  assert.equal(eas.build?.development?.ios?.simulator, true);
  assert.equal(eas.build?.simulator?.ios?.simulator, true);
  assert.ok(!eas.build?.simulator?.developmentClient);
  assert.equal(eas.build?.production?.channel, "production");
  assert.equal(eas.build?.production?.autoIncrement, true);
  assert.equal(
    eas.build?.production?.env?.EXPO_PUBLIC_API_BASE,
    "https://tinker.beginner.work",
  );
  assert.ok(eas.submit?.production, "submit.production missing");

  const pkg = JSON.parse(
    fs.readFileSync(path.join(MOBILE, "package.json"), "utf8"),
  );
  assert.ok(pkg.scripts["build:ios"], "build:ios missing");
  assert.ok(pkg.scripts["submit:ios"], "submit:ios missing");
  assert.ok(pkg.scripts["release:ios"], "release:ios missing");
  assert.ok(pkg.scripts["publish:production"], "publish:production missing");

  const root = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );
  assert.ok(root.scripts["expo:release:ios"], "root expo:release:ios missing");
  assert.ok(root.scripts["expo:build:ios"], "root expo:build:ios missing");

  assert.ok(
    fs.existsSync(path.join(__dirname, "..", ".github/workflows/eas-ios.yml")),
    "eas-ios workflow missing",
  );
});
