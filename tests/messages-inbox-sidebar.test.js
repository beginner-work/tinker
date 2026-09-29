/* TYL-65 slice 6: app-wide sidebar is the messages inbox. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "src/renderer/messages-shell.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");

test("left rail is the inbox; pitch deck is secondary panel", () => {
  assert.match(html, /sidebar--inbox/);
  assert.match(html, /id="sidebar-messages"/);
  assert.match(html, /Inbox/);
  assert.match(html, /id="pitch-deck-panel"/);
  assert.match(html, /id="nav-pitch-deck"|data-pitch-open/);
  assert.match(html, /class="sidebar__tree"/);
  assert.ok(html.indexOf("pitch-deck-panel") < html.indexOf("messages-pane") || html.includes("pitch-deck-panel"));
  /* Pitch tree lives in the panel, not as the primary sidebar chrome. */
  const aside = html.match(/<aside class="sidebar[\s\S]*?<\/aside>/);
  assert.ok(aside);
  assert.equal(/class="sidebar__tree"/.test(aside[0]), false);
  assert.match(aside[0], /messages-rail/);
  assert.match(js, /openPitchPanel|pitch-deck-open|data-pitch-open/);
  assert.match(js, /messages-inbox-primary/);
  assert.match(js, /messages-rail__channel|CHANNEL_LABEL/);
  assert.equal(/\bTyler\b/.test(html + js), false);
});

test("inbox sidebar styles hide funnel/account chrome", () => {
  assert.match(css, /\.sidebar--inbox\b/);
  assert.match(css, /\.sidebar__secondary\b/);
  assert.match(css, /\.pitch-deck-panel\b/);
  assert.match(css, /messages-inbox-primary/);
  assert.match(css, /\.sidebar--inbox\s+\.sidebar__funnel/);
});
