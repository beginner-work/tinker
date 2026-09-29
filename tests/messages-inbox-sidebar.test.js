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
  assert.match(html, /href="\/story-parts"/);
  const aside = html.match(/<aside class="sidebar[\s\S]*?<\/aside>/);
  assert.ok(aside);
  assert.match(aside[0], /messages-rail/);
  assert.match(js, /messages-inbox-primary/);
  assert.equal(/openPitchPanel|pitch-deck-open/.test(js), false);
  assert.equal(/\bTyler\b/.test(html + js), false);
});

test("inbox sidebar styles keep secondary links without pitch panel", () => {
  assert.match(css, /\.sidebar--inbox\b/);
  assert.match(css, /\.sidebar__secondary\b/);
  assert.equal(/\.pitch-deck-panel\b/.test(css), false);
  assert.match(css, /messages-inbox-primary/);
});
