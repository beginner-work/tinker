/* Back me opener contract (back-me.js + its wiring).
 *
 * The founder's "Back me" page (their profile QR) lives on beginner, a
 * different origin. back-me.js is the one place that builds the cross-origin
 * URL — carrying the tinker session in the fragment so beginner recognises
 * the owner — and decides where it opens:
 *   - installed PWA (standalone)  → in-app iframe overlay (stay in the app)
 *   - everywhere else             → system browser via openExternal
 *
 * It's shared by the sidebar Pitch button and the profile menu, so the QR is
 * reachable without the Pitch button. These are source-level contract tests
 * (the renderer sandbox has only a no-op DOM), matching pitch-backme.test.js.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.resolve(__dirname, "..", "src", "renderer");
const read = (p) => fs.readFileSync(path.join(SRC_DIR, p), "utf8");

const BACKME_SRC = read("back-me.js");
const INDEX_HTML = read("index.html");
const PROFILE_SRC = read("profile.js");
const TREE_SRC = read("sidebar-tree.js");

// Pull the host out of the `https://<host>/tyler-lindow#share` Back me URL
// literal a source file builds. Returns null if the file doesn't define one.
function backMeHost(src) {
  const m = src.match(/https:\/\/([^/"'\s]+)\/tyler-lindow#share/);
  return m ? m[1] : null;
}

test("back-me.js exposes a shared opener on window", () => {
  assert.match(
    BACKME_SRC,
    /window\.tinkerBackMe\s*=\s*\{[^}]*open[^}]*\}/,
    "must expose window.tinkerBackMe with an open()",
  );
});

test("the Back me URL carries the tinker session and targets the canonical page", () => {
  assert.match(
    BACKME_SRC,
    /localStorage\.getItem\("tinker_jwt"\)/,
    "reads the founder's session token",
  );
  assert.match(
    BACKME_SRC,
    /\+\s*"&ts="\s*\+\s*encodeURIComponent/,
    "the token rides in a URL-encoded `ts` fragment param",
  );
  assert.match(
    BACKME_SRC,
    /https:\/\/www\.beginner\.work\/tyler-lindow#share/,
    "targets the canonical www.beginner.work Back me page (#share)",
  );
  // The bare apex redirects to www; linking to the apex makes the PWA iframe
  // follow a cross-origin redirect onto a host frame-src doesn't allow.
  assert.doesNotMatch(
    BACKME_SRC,
    /["']https:\/\/beginner\.work\/tyler-lindow/,
    "must not link at the bare apex (it redirects to www)",
  );
  // Same regression guard as the Pitch button: production tinker is on
  // *.vercel.app, so the URL must not be a beginner branch-preview alias.
  assert.doesNotMatch(
    BACKME_SRC,
    /beginner-git-[\w-]*\.vercel\.app/,
    "must not point at a beginner branch-preview alias",
  );
});

test("an installed PWA opens the QR in an in-app iframe; otherwise the browser", () => {
  assert.match(
    BACKME_SRC,
    /display-mode: standalone/,
    "detects an installed PWA via the standalone display-mode",
  );
  assert.match(
    BACKME_SRC,
    /navigator\.standalone/,
    "also honours iOS's navigator.standalone",
  );
  // Standalone → overlay (iframe); else → openExternal.
  assert.match(
    BACKME_SRC,
    /if\s*\(isStandalone\(\)\)\s*openOverlay/,
    "standalone opens the in-app overlay",
  );
  assert.match(
    BACKME_SRC,
    /else\s*openExternal/,
    "everything else hands off to the browser",
  );
  assert.match(BACKME_SRC, /document\.createElement\("iframe"\)/, "the overlay embeds an iframe");
  assert.match(BACKME_SRC, /referrerpolicy/, "the iframe keeps the Referer clean");
});

test("the overlay iframe delegates web-share and clipboard-write so the Back me Share/Copy buttons work", () => {
  // The Back me page is cross-origin (tinker → www.beginner.work). Both
  // web-share and clipboard-write default to a `self`-only Permissions Policy
  // allowlist, so navigator.share() and navigator.clipboard.writeText() inside
  // the framed page are blocked unless the embedding iframe hands the features
  // down with an `allow` attribute. Missing this made the Share button silently
  // do nothing (navigator.share() rejecting into profile.js's empty catch).
  const allowMatch = BACKME_SRC.match(/setAttribute\(\s*"allow"\s*,\s*"([^"]*)"\s*\)/);
  assert.ok(allowMatch, "the overlay iframe must set an `allow` attribute");
  assert.match(allowMatch[1], /web-share/, "must delegate web-share for the Share button");
  assert.match(allowMatch[1], /clipboard-write/, "must delegate clipboard-write for the Copy link button");
});

test("the overlay is dismissable (close button + Escape + backdrop)", () => {
  assert.match(BACKME_SRC, /aria-modal/, "the overlay is a modal dialog");
  assert.match(BACKME_SRC, /backme-overlay__close/, "has a close control");
  assert.match(BACKME_SRC, /e\.key === "Escape"/, "Escape closes it");
  assert.match(BACKME_SRC, /backdrop\.addEventListener\("click", closeOverlay\)/, "clicking the backdrop closes it");
});

test("index.html loads back-me.js and lets the iframe frame beginner", () => {
  assert.match(INDEX_HTML, /<script src="\.\/back-me\.js"/, "the shared opener is loaded");
  // The iframe target is cross-origin, so the CSP must allow framing beginner.
  assert.match(
    INDEX_HTML,
    /frame-src[^;]*https:\/\/www\.beginner\.work/,
    "CSP frame-src must allow https://www.beginner.work for the in-app iframe",
  );
});

test("regression: the Back me iframe host is allowlisted by the CSP, so the PWA panel can't blank", () => {
  // The original Pitch-button bug: the in-app iframe pointed at one host
  // (the bare apex, which redirects) while the CSP frame-src allowed a
  // different one, so the cross-origin frame was blocked and the founder saw
  // a blank white panel. This test wires the three moving parts together so
  // they can never silently drift apart again:
  //   1. back-me.js and sidebar-tree.js must build the SAME Back me host, and
  //   2. that exact host must appear in index.html's frame-src allowlist.
  const backmeHost = backMeHost(BACKME_SRC);
  const treeHost = backMeHost(TREE_SRC);
  assert.ok(backmeHost, "back-me.js must build a Back me URL");
  assert.ok(treeHost, "sidebar-tree.js must build a Back me URL");
  assert.equal(
    backmeHost,
    treeHost,
    "the two Back me URLs must share one host (or they'll drift)",
  );

  const cspMatch = INDEX_HTML.match(/frame-src([^;]*)/);
  assert.ok(cspMatch, "index.html must declare a frame-src directive");
  assert.ok(
    cspMatch[1].includes("https://" + backmeHost),
    `frame-src must allow https://${backmeHost} so the Back me iframe loads ` +
      "instead of rendering a blank panel",
  );
});

test("the profile menu offers a non-Pitch entry into the Back me page", () => {
  assert.match(
    INDEX_HTML,
    /id="profile-backme"/,
    "the profile popover has a 'show my QR' action",
  );
  assert.match(
    PROFILE_SRC,
    /window\.tinkerBackMe\.open\(\)/,
    "the profile menu action opens the Back me page via the shared opener",
  );
});
