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

test("shell keeps the pre-profile welcome step", () => {
  // One welcome page precedes the profile-details form; "Begin" reveals it.
  for (const id of ["onboarding-welcome", "onboarding-begin", "onboarding-details"]) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} is missing`);
  }
  // The details wrapper ships hidden so the welcome step shows first.
  assert.match(
    html,
    /id="onboarding-details"[^>]*hidden/,
    "onboarding-details must ship hidden behind the welcome step",
  );
});

test("profile.js reveals the details form when Begin is tapped", () => {
  assert.match(js, /onboarding-welcome/, "welcome step ref missing");
  assert.match(js, /onboarding-begin/, "begin button ref missing");
  assert.match(js, /onboarding-details/, "details step ref missing");
  // Begin advances welcome → details.
  assert.match(js, /beginBtn\.addEventListener\("click"/, "Begin click must be wired");
});

test("profile.js talks to the claim + profile endpoints", () => {
  assert.match(js, /\/api\/profile\/claim/, "claim endpoint call missing");
  assert.match(js, /\/api\/user-data\/profile/, "profile endpoint call missing");
  assert.match(js, /tinker_claim/, "claim localStorage key missing");
  assert.match(js, /tinker_jwt/, "session token key missing");
});

test("profile.js saves onboarding via PUT with an avatarUrl", () => {
  assert.match(js, /method:\s*"PUT"/, "onboarding save must PUT the profile");
  assert.match(js, /avatarUrl/, "saved profile must carry an avatarUrl");
  // Onboarding is gated to the web sign-in surface, not wrapped runtimes.
  assert.match(js, /on-web/, "onboarding should be gated to the web platform");
  // Claim/render run after sign-in.
  assert.match(js, /tinker:auth-changed/, "must hydrate on auth-changed");
});
