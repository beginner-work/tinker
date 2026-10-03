/* App chrome no longer centers on an inbox rail; stories live on /repo. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "src/renderer/messages-shell.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");

test("inbox rail is removed from the primary UI", () => {
  assert.doesNotMatch(html, /sidebar--inbox/);
  assert.doesNotMatch(html, />Inbox</);
  assert.doesNotMatch(html, /No people yet\./);
  assert.match(html, /id="sidebar-messages"/);
  assert.match(html, /write-surface|Stories/);
  assert.equal(/pitch-deck-panel|nav-pitch-deck|data-pitch-open/.test(html), false);
  assert.equal(/pitches\.js|sidebar-tree\.js|pitch-script\.js|founders\.js/.test(html), false);
  assert.match(html, /href="\/settings"/);
  assert.equal(/sidebar__secondary/.test(html), false);
  assert.match(js, /goRepoHome|\/repo/);
  assert.match(js, /wantsWriteSurface/);
  assert.equal(/openPitchPanel|pitch-deck-open/.test(js), false);
  assert.equal(/\bTyler\b/.test(html + js), false);
  const settings = fs.readFileSync(path.join(root, "src/renderer/settings/index.html"), "utf8");
  assert.match(settings, /href="\/leads"/);
  assert.match(settings, /href="\/repo"/);
  assert.equal(/href="\/story-parts"/.test(settings), false);
});

test("legacy inbox styles may remain but are not the landing chrome", () => {
  // styles.css may still contain inbox selectors for demos; landing is /repo.
  assert.match(css, /messages-inbox-primary|sidebar--inbox|write-surface/);
  assert.match(js, /write-surface/);
});

test("Share stays Settings-only; writing is linked from Settings", () => {
  assert.match(html, /id="nav-share"[^>]*hidden/);
  const share = fs.readFileSync(path.join(root, "src/renderer/share.js"), "utf8");
  assert.match(share, /open=share|openShare/);
  assert.match(share, /btn\.hidden\s*=\s*true/);
  assert.equal(/btn\.hidden\s*=\s*false/.test(share), false);
  const settings = fs.readFileSync(path.join(root, "src/renderer/settings/index.html"), "utf8");
  assert.match(settings, /href="\/\?open=share"/);
  assert.match(settings, />Share</);
  assert.match(settings, /href="\/\?write=1"/);
});
