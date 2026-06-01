/* UI-contract guard for the profile feature on the renderer.
 *
 * Structural smoke test (parses shipped source, asserts the load-bearing
 * anchors exist and are wired) — same approach as welcome-shell.test.js.
 * Covers the top-right avatar, the first-login onboarding capture, and the
 * claim/profile endpoints the renderer talks to. Behavioural coverage of
 * the claim endpoint lives in profile-claim.test.js.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RENDERER = path.join(__dirname, "..", "src", "renderer");
const html = fs.readFileSync(path.join(RENDERER, "index.html"), "utf8");
const js = fs.readFileSync(path.join(RENDERER, "profile.js"), "utf8");
const rendererJs = fs.readFileSync(path.join(RENDERER, "renderer.js"), "utf8");

test("shell wires the profile stylesheet and deferred script", () => {
  assert.match(html, /href="\.\/profile\.css"/, "profile.css link missing");
  assert.match(html, /src="\.\/profile\.js"\s+defer/, "profile.js must be deferred");
});

test("shell keeps the top-right avatar corner", () => {
  assert.match(html, /id="profile-corner"/, "profile-corner missing");
  assert.match(html, /class="profile-avatar__img"/, "avatar img missing");
  assert.match(html, /id="profile-popover"/, "profile popover missing");
});

test("shell keeps the onboarding capture markup", () => {
  for (const id of [
    "profile-onboarding",
    "onboarding-form",
    "onboarding-avatar",
    "onboarding-name",
    "onboarding-email",
    "onboarding-save",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} is missing`);
  }
  assert.match(html, /class="onboarding__avatar-img"/, "onboarding avatar preview missing");
  // The file input must accept images for the photo picker.
  assert.match(html, /id="onboarding-avatar"[^>]*accept="image\/\*"/, "avatar input must accept images");
});

test("profile.js talks to the claim + profile endpoints", () => {
  assert.match(js, /\/api\/profile\/claim/, "claim endpoint call missing");
  assert.match(js, /\/api\/user-data\/profile/, "profile endpoint call missing");
  assert.match(js, /tinker_claim/, "claim localStorage key missing");
  assert.match(js, /tinker_jwt/, "session token key missing");
});

test("onboarding is parked behind the location flow, not forced on sign-in", () => {
  // A missing profile parks a token instead of immediately showing the
  // capture overlay, so the "where are you right now?" location flow comes
  // first. The public API lets renderer.js drive the order.
  assert.match(js, /pendingToken\s*=\s*token/, "missing profile must park a pending token");
  assert.match(js, /window\.tinkerProfile\s*=/, "must expose window.tinkerProfile");
  assert.match(js, /needsOnboarding/, "API must expose needsOnboarding()");
  assert.match(js, /runOnboarding/, "API must expose runOnboarding()");
  // The capture screen is no longer shown straight from hydrate's missing branch.
  assert.doesNotMatch(
    js,
    /state === "missing" && isWebGate\(\)\) showOnboarding/,
    "hydrate must not force onboarding before the location flow",
  );
});

test("renderer starts the location session through the profile gate", () => {
  // Picking a location runs onboarding first (when pending), then opens the
  // seeded session — so profile details are asked for after the location flow.
  assert.match(rendererJs, /window\.tinkerProfile/, "renderer must consult the profile gate");
  assert.match(rendererJs, /needsOnboarding\(\)/, "renderer must check needsOnboarding()");
  assert.match(rendererJs, /runOnboarding\(\)\.then\(begin\)/, "renderer must defer the session until onboarding resolves");
});

test("profile.js saves onboarding via PUT with an avatarUrl", () => {
  assert.match(js, /method:\s*"PUT"/, "onboarding save must PUT the profile");
  assert.match(js, /avatarUrl/, "saved profile must carry an avatarUrl");
  // Onboarding is gated to the web sign-in surface, not wrapped runtimes.
  assert.match(js, /on-web/, "onboarding should be gated to the web platform");
  // Claim/render run after sign-in.
  assert.match(js, /tinker:auth-changed/, "must hydrate on auth-changed");
});
