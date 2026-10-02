/* Home chrome is the Lindow Labs overview (inbox triage UI removed). */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "src/renderer/messages-shell.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");

test("left rail is overview chrome with no pitch deck", () => {
  assert.match(html, /sidebar--overview/);
  assert.match(html, /overview-primary/);
  assert.match(html, /Lindow Labs/);
  assert.equal(/messages-rail__title">Inbox</.test(html), false);
  assert.equal(/pitch-deck-panel|nav-pitch-deck|data-pitch-open/.test(html), false);
  assert.equal(/pitches\.js|sidebar-tree\.js|pitch-script\.js|founders\.js/.test(html), false);
  assert.match(html, /href="\/settings"/);
  assert.match(html, /messages-rail__settings/);
  assert.equal(/sidebar__secondary/.test(html), false);
  assert.match(js, /isOverviewMode/);
  assert.equal(/openPitchPanel|pitch-deck-open/.test(js), false);
  assert.equal(/\bTyler\b/.test(html + js), false);
  const settings = fs.readFileSync(path.join(root, "src/renderer/settings/index.html"), "utf8");
  assert.match(settings, /href="\/leads"/);
  assert.equal(/href="\/story-parts"/.test(settings), false);
});

test("overview sidebar styles keep settings gear without pitch panel", () => {
  assert.match(css, /\.sidebar--overview\b/);
  assert.match(css, /\.messages-rail__settings\b/);
  assert.equal(/\.pitch-deck-panel\b/.test(css), false);
});

test("Settings control is a quiet labeled rail target; Share is Settings-only", () => {
  assert.match(html, /messages-rail__settings-label/);
  assert.match(html, /id="nav-share"[^>]*hidden/);
  assert.match(css, /\.messages-rail__settings[\s\S]*font-size:\s*12px/);
  assert.match(css, /\.messages-rail__settings[\s\S]*font-weight:\s*400/);
  assert.match(css, /\.messages-rail__settings[\s\S]*color:\s*var\(--color-muted\)/);
  assert.match(css, /\.messages-rail__settings-icon[\s\S]*width:\s*15px/);
  assert.match(css, /\.messages-rail__settings-icon[\s\S]*height:\s*15px/);
  assert.match(css, /\.sidebar--overview \.sidebar__footer[\s\S]*border-top:\s*0/);
  assert.match(css, /\.sidebar--overview \.sidebar__footer[\s\S]*margin-top:\s*auto/);
  assert.match(css, /\.messages-rail__settings[\s\S]*border:\s*0/);
  const share = fs.readFileSync(path.join(root, "src/renderer/share.js"), "utf8");
  assert.match(share, /open=share|openShare/);
  assert.match(share, /btn\.hidden\s*=\s*true/);
  assert.equal(/btn\.hidden\s*=\s*false/.test(share), false);
  const settings = fs.readFileSync(path.join(root, "src/renderer/settings/index.html"), "utf8");
  assert.match(settings, /href="\/\?open=share"/);
  assert.match(settings, />Share</);
});
