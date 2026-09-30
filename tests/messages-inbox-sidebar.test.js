/* TYL-65: app-wide sidebar is the messages inbox (no pitch deck). */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "src/renderer/messages-shell.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");

test("left rail is the inbox with no pitch deck chrome", () => {
  assert.match(html, /sidebar--inbox/);
  assert.match(html, /id="sidebar-messages"/);
  assert.match(html, /Inbox/);
  assert.equal(/pitch-deck-panel|nav-pitch-deck|data-pitch-open/.test(html), false);
  assert.equal(/pitches\.js|sidebar-tree\.js|pitch-script\.js|founders\.js/.test(html), false);
  assert.match(html, /href="\/settings"/);
  assert.match(html, /messages-rail__settings/);
  assert.equal(/sidebar__secondary/.test(html), false);
  const aside = html.match(/<aside class="sidebar[\s\S]*?<\/aside>/);
  assert.ok(aside);
  assert.match(aside[0], /messages-rail/);
  assert.match(js, /messages-inbox-primary/);
  assert.equal(/openPitchPanel|pitch-deck-open/.test(js), false);
  assert.equal(/\bTyler\b/.test(html + js), false);
  const settings = fs.readFileSync(path.join(root, "src/renderer/settings/index.html"), "utf8");
  assert.match(settings, /href="\/story-parts"/);
});

test("inbox sidebar styles keep settings gear without pitch panel", () => {
  assert.match(css, /\.sidebar--inbox\b/);
  assert.match(css, /\.messages-rail__settings\b/);
  assert.equal(/\.pitch-deck-panel\b/.test(css), false);
  assert.match(css, /messages-inbox-primary/);
});

test("Settings control is a large labeled rail target; Share is Settings-only", () => {
  assert.match(html, /messages-rail__settings-label/);
  assert.match(html, /id="nav-share"[^>]*hidden/);
  assert.match(css, /\.messages-rail__settings[\s\S]*min-height:\s*48px/);
  assert.match(css, /\.messages-rail__settings[\s\S]*font-weight:\s*600/);
  // Bottom-anchored, no hairline dividers around Settings.
  assert.match(css, /\.sidebar--inbox \.sidebar__footer[\s\S]*border-top:\s*0/);
  assert.match(css, /\.sidebar--inbox \.sidebar__footer[\s\S]*margin-top:\s*auto/);
  assert.match(css, /\.messages-rail__settings[\s\S]*border:\s*0/);
  const share = fs.readFileSync(path.join(root, "src/renderer/share.js"), "utf8");
  // Deep link from Settings → Pages still works; rail never unhides Share.
  assert.match(share, /open=share|openShare/);
  assert.match(share, /btn\.hidden\s*=\s*true/);
  assert.equal(/btn\.hidden\s*=\s*false/.test(share), false);
  const settings = fs.readFileSync(path.join(root, "src/renderer/settings/index.html"), "utf8");
  assert.match(settings, /href="\/\?open=share"/);
  assert.match(settings, />Share</);
});
