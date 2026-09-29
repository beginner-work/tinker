/* TYL-65 slice 5: chat bubbles in the thread. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const js = fs.readFileSync(path.join(root, "src/renderer/messages-thread.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");

test("thread maps sent, draft, and lead reply sides", () => {
  assert.match(js, /item--owner|side:\s*"owner"/);
  assert.match(js, /side:\s*"lead"/);
  assert.match(js, /kind:\s*sent\s*\?\s*"sent"\s*:\s*"draft"|kind:\s*"sent"|kind:\s*"draft"/);
  assert.match(js, /Draft/);
  assert.match(js, /messages-thread__meta/);
  assert.match(js, /Reply(?:\s*\()/);
  assert.match(js, /isInboundDraft|fromLead|direction/);
  assert.match(js, /groupKey|grouped/);
  assert.equal(/\bSend\b/.test(js), false);
  assert.equal(/\bTyler\b/.test(js), false);
});

test("composer uses Ship and Next with no Send", () => {
  assert.match(html, /id="messages-composer"/);
  assert.match(html, />Ship</);
  assert.match(html, />Next</);
  const foot = html.match(/id="messages-composer"[\s\S]*?<\/footer>/);
  assert.ok(foot);
  assert.equal(/\bSend\b/.test(foot[0]), false);
});

test("bubble styles: solid sent right, draft tint, lead left", () => {
  assert.match(css, /\.messages-thread__item--owner\b/);
  assert.match(css, /\.messages-thread__item--lead\b/);
  assert.match(css, /\.messages-thread__item--sent\b/);
  assert.match(css, /\.messages-thread__item--draft\b/);
  assert.match(css, /align-self:\s*flex-end/);
  assert.match(css, /align-self:\s*flex-start/);
  assert.match(css, /messages-thread__meta/);
  assert.match(css, /border-radius:\s*16px/);
  assert.equal(/\.messages-thread__list[^{]*\{[^}]*box-shadow/.test(css), false);
});
