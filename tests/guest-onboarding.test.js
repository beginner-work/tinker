/* UI-contract regression guard for the signed-out onboarding flow.
 *
 * Structural smoke test in the same spirit as welcome-shell.test.js: it
 * parses the shipped renderer source and asserts the load-bearing
 * pieces of the guest flow are present and wired. The contract:
 *
 *   1. A signed-out web visitor starts on the welcome grid — auth.js
 *      must NOT auto-show the gate on load anymore. The gate is raised
 *      on demand (question budget spent, or a 401 mid-session).
 *   2. The pre-login interview is capped at three fixed local questions
 *      (the Claude proxy is Stytch-gated, so guests never call it).
 *   3. Attribution: guest-entry.js records the chosen location + each
 *      answer under an anonymous entry id and attaches the entry to the
 *      account via /api/entry/attach when the verify lands.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RENDERER = path.join(__dirname, "..", "src", "renderer");
const html = fs.readFileSync(path.join(RENDERER, "index.html"), "utf8");
const authJs = fs.readFileSync(path.join(RENDERER, "auth.js"), "utf8");
const writingJs = fs.readFileSync(path.join(RENDERER, "writing.js"), "utf8");
const rendererJs = fs.readFileSync(path.join(RENDERER, "renderer.js"), "utf8");
const guestJs = fs.readFileSync(path.join(RENDERER, "guest-entry.js"), "utf8");

test("the app boots to the welcome grid — auth.js no longer auto-shows the gate", () => {
  // The welcome feed is the default active view…
  assert.match(html, /<section id="welcome"[^>]*data-active/, "welcome section is not the default view");
  // …and nothing in auth.js shows the gate just because the token is
  // missing. (showGate stays exposed for on-demand use.)
  assert.doesNotMatch(
    authJs,
    /if\s*\(\s*!auth\.token\s*\)\s*\{\s*showGate\(\)/,
    "auth.js auto-shows the gate on load again — signed-out visitors must start on the welcome grid"
  );
  assert.match(authJs, /auth\.showGate\s*=\s*showGate/, "tinkerAuth.showGate is no longer exposed");
});

test("index.html loads guest-entry.js between platform-mobile.js and auth.js", () => {
  const shim = html.indexOf('src="./platform-mobile.js"');
  const guest = html.indexOf('src="./guest-entry.js"');
  const auth = html.indexOf('src="./auth.js"');
  assert.ok(guest > -1, "guest-entry.js is not loaded");
  assert.ok(shim > -1 && shim < guest, "guest-entry.js must load after platform-mobile.js (.on-web)");
  assert.ok(guest < auth, "guest-entry.js must load before auth.js");
});

test("the guest interview is capped at three fixed questions", () => {
  assert.match(guestJs, /QUESTION_LIMIT\s*=\s*3/, "guest question budget is no longer 3");
  assert.match(writingJs, /GUEST_QUESTIONS\s*=\s*\[/, "writing.js lost the fixed guest question list");
  // Exactly three entries in the list.
  const block = writingJs.match(/GUEST_QUESTIONS\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(block, "GUEST_QUESTIONS array not found");
  const count = (block[1].match(/,\s*$/gm) || []).length;
  assert.equal(count, 3, `expected 3 guest questions, found ${count}`);
  // The guest engine gates on the budget and routes to the sign-in card.
  assert.match(writingJs, /questionsRemaining/, "writing.js no longer consults the global guest budget");
  assert.match(writingJs, /renderSignIn/, "writing.js lost the sign-in hand-off card");
  assert.match(writingJs, /tinkerAuth[\s\S]{0,80}showGate/, "the sign-in card no longer raises the auth gate");
});

test("attribution: location + answers are recorded and attached to the session", () => {
  // The welcome grid records the chosen location…
  assert.match(rendererJs, /tinkerGuestEntry[\s\S]{0,120}recordLocation/, "renderer.js no longer records the location");
  // …the interview records each committed answer…
  assert.match(writingJs, /tinkerGuestEntry[\s\S]{0,120}recordAnswer/, "writing.js no longer records guest answers");
  // …and the entry is tied to the account when the verify lands.
  assert.match(guestJs, /\/api\/entry\/attach/, "guest-entry.js no longer posts to /api/entry/attach");
  assert.match(guestJs, /tinker:auth-changed/, "guest-entry.js no longer attaches on auth-changed");
  assert.ok(
    fs.existsSync(path.join(__dirname, "..", "api", "entry", "attach.js")),
    "api/entry/attach.js endpoint is missing"
  );
});
