/* UI-contract: writing privacy line on sign-up and settings. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PRIVACY =
  "Tinker measures how you write, like pace and pauses, never the words.";

const RENDERER = path.join(__dirname, "..", "src", "renderer");

test("sign-up auth gate shows the writing privacy line", () => {
  const html = fs.readFileSync(path.join(RENDERER, "index.html"), "utf8");
  assert.match(html, /id="auth-gate"/);
  assert.ok(
    html.includes(PRIVACY),
    "auth gate must include the exact privacy line"
  );
  assert.ok(!PRIVACY.includes("—") && !PRIVACY.includes("–"), "privacy copy must not use an em/en dash");
});

test("settings page shows the writing privacy line near account area", () => {
  const html = fs.readFileSync(path.join(RENDERER, "settings", "index.html"), "utf8");
  assert.ok(
    html.includes(PRIVACY),
    "settings must include the exact privacy line"
  );
  // Near the account/profile chrome: after the settings lede, before Owner profile.
  const privacyAt = html.indexOf(PRIVACY);
  const profileAt = html.indexOf("settings-profile-heading");
  assert.ok(privacyAt > 0 && profileAt > privacyAt, "privacy line should appear before Owner profile");
});
