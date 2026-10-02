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
  assert.match(index, /publishEssayWithPullRequest/);

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

test("Home is the writing surface with a location dropdown", () => {
  const index = fs.readFileSync(path.join(APP, "index.tsx"), "utf8");
  assert.match(index, /LocationPicker/);
  assert.match(index, /What are you learning\?/);
  assert.match(index, /Type your answer in your own words…/);
  assert.match(index, /Next →/);
  assert.match(index, /This is everything →/);
  assert.doesNotMatch(index, /You are a founder/);
  assert.doesNotMatch(index, /You just need a seed/);
  assert.doesNotMatch(index, /Where are you right now\?/);
  assert.doesNotMatch(index, /WelcomeBody/);

  const picker = fs.readFileSync(
    path.join(MOBILE, "src/components/LocationPicker.tsx"),
    "utf8",
  );
  assert.match(picker, /Cafe/);
  assert.match(picker, /Home/);
  assert.match(picker, /Work/);
  assert.match(picker, /Somewhere else/);
  assert.match(picker, /chevron-down/);
  assert.match(picker, /Where are you\?/);

  assert.ok(
    !fs.existsSync(path.join(MOBILE, "src/components/WelcomeBody.tsx")),
    "WelcomeBody should be removed",
  );
});

test("Framing copy is stripped from auth and chrome", () => {
  const signIn = fs.readFileSync(path.join(APP, "sign-in.tsx"), "utf8");
  assert.match(signIn, /\(555\) 000-0000/);
  assert.match(signIn, /Send code/);
  assert.match(signIn, /Verify/);
  assert.doesNotMatch(signIn, /Sign in to tinker/);
  assert.doesNotMatch(signIn, /quiet place to be on the web/);
  assert.doesNotMatch(signIn, /Sign-up and login share this screen/);

  const assessing = fs.readFileSync(path.join(APP, "assessing.tsx"), "utf8");
  assert.match(assessing, /Keep writing →/);
  assert.match(assessing, /Re-read your essay/);
  assert.doesNotMatch(assessing, /Your pitch is being assessed/);
  assert.doesNotMatch(assessing, /You created another essay/);

  const founders = fs.readFileSync(path.join(APP, "founders.tsx"), "utf8");
  assert.match(founders, /find my founders/);
  assert.doesNotMatch(founders, /When you make a pitch discoverable/);

  const pitch = fs.readFileSync(path.join(APP, "pitch-script.tsx"), "utf8");
  assert.match(pitch, /Copy script/);
  assert.doesNotMatch(pitch, /Prepare a script for a video/);
  assert.doesNotMatch(pitch, /Eleven headings/);

  const drawer = fs.readFileSync(
    path.join(MOBILE, "src/components/SidebarDrawer.tsx"),
    "utf8",
  );
  assert.doesNotMatch(drawer, /quiet place to be on the web/);
  assert.doesNotMatch(drawer, /© 2026 tinker/);
  assert.doesNotMatch(drawer, /Liquid Glass/);
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
