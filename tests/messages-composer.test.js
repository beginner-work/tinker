/* TYL-65 slice 3: bottom composer from story parts. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "src/renderer/messages-composer.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
const draftsJs = fs.readFileSync(path.join(root, "src/renderer/lead-drafts.js"), "utf8");

test("composer is wired with Save draft only and no Send", () => {
  assert.match(html, /id="messages-composer"/);
  assert.match(html, /messages-composer\.js/);
  assert.match(html, /data-composer-save/);
  assert.match(html, /Save draft/);
  assert.match(html, /data-composer-parts/);
  assert.match(js, /tinkerMessagesComposer/);
  assert.match(js, /story-parts/);
  assert.match(js, /Save draft|Draft saved/);
  assert.match(js, /never sends/i);
  assert.equal(/\bSend\b/.test(html.match(/id="messages-composer"[\s\S]*?<\/footer>/)[0]), false);
  assert.equal(/sendgrid|MESSAGING_SEND/.test(js), false);
  assert.equal(/\bTyler\b/.test(js + html), false);
});

test("sidebar draft list is gone; settings remain", () => {
  assert.equal(/data-drafts-list/.test(html), false);
  assert.match(html, /data-drafts-from/);
  assert.match(html, /data-drafts-booking/);
  assert.match(draftsJs, /Draft list removed in TYL-65/);
});

test("composer styles stay flat", () => {
  assert.match(css, /\.messages-composer\b/);
  assert.match(css, /\.messages-composer__save\b/);
  assert.match(css, /\.messages-composer__bar\b/);
  assert.match(css, /\.messages-composer__chip\b/);
  assert.equal(/\.messages-composer[^{]*\{[^}]*box-shadow/.test(css), false);
});

test("composer is a chat bar with inline chips, not a stacked form", () => {
  assert.match(html, /messages-composer__bar/);
  assert.match(html, /messages-composer__chips/);
  assert.match(js, /messages-composer__chip/);
  assert.match(js, /growTextarea/);
  assert.equal(/messages-composer__field--block/.test(html), false);
});
