/* Open beginner opener contract (open-beginner.js + its wiring).
 *
 * tinker and beginner are two surfaces a founder walks between. The profile
 * menu's "Open beginner" switches over to the beginner app, carrying the
 * tinker session in the URL fragment so the founder lands signed in — the
 * reciprocal of beginner's drawer "Open tinker". Unlike back-me.js (which can
 * stay in-app via an iframe to show a QR), switching surfaces always means
 * leaving tinker, so it hands off to the browser, never an iframe.
 *
 * Source-level contract tests (the renderer sandbox has only a no-op DOM),
 * matching back-me.test.js / pitch-backme.test.js.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.resolve(__dirname, "..", "src", "renderer");
const read = (p) => fs.readFileSync(path.join(SRC_DIR, p), "utf8");

const SRC = read("open-beginner.js");
const INDEX_HTML = read("index.html");
const PROFILE_SRC = read("profile.js");

test("open-beginner.js exposes a shared opener on window", () => {
  assert.match(
    SRC,
    /window\.tinkerOpenBeginner\s*=\s*\{[^}]*open[^}]*\}/,
    "must expose window.tinkerOpenBeginner with an open()",
  );
});

test("the Open beginner URL carries the tinker session and targets the canonical host", () => {
  assert.match(
    SRC,
    /localStorage\.getItem\("tinker_jwt"\)/,
    "reads the founder's session token",
  );
  assert.match(
    SRC,
    /"#ts="\s*\+\s*encodeURIComponent/,
    "the token rides in a URL-encoded `ts` fragment param (never sent to a server)",
  );
  assert.match(
    SRC,
    /https:\/\/www\.beginner\.work\//,
    "targets the canonical www.beginner.work host",
  );
  // The bare apex 308-redirects to www; link straight to www so the carried
  // `ts` fragment survives (same rule as back-me.js).
  assert.doesNotMatch(
    SRC,
    /["']https:\/\/beginner\.work\//,
    "must not link at the bare apex (it redirects to www)",
  );
  // Production tinker is on *.vercel.app, so the URL must not be a beginner
  // branch-preview alias.
  assert.doesNotMatch(
    SRC,
    /beginner-git-[\w-]*\.vercel\.app/,
    "must not point at a beginner branch-preview alias",
  );
});

test("switching surfaces leaves tinker for the browser — never an in-app iframe", () => {
  assert.match(SRC, /openExternal/, "hands off to the system browser / new context");
  assert.doesNotMatch(
    SRC,
    /createElement\("iframe"\)/,
    "switching must not embed beginner in an iframe (that's back-me.js's job)",
  );
});

test("index.html loads open-beginner.js and offers the switch in the profile menu", () => {
  assert.match(INDEX_HTML, /<script src="\.\/open-beginner\.js"/, "the opener is loaded");
  assert.match(INDEX_HTML, /id="profile-open-beginner"/, "the profile popover has an 'Open beginner' action");
});

test("the profile menu wires the switch through the shared opener", () => {
  assert.match(
    PROFILE_SRC,
    /window\.tinkerOpenBeginner\.open\(\)/,
    "the profile menu action switches surfaces via the shared opener",
  );
});
