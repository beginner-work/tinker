/* TYL-65: invisible notepad composer with approve-to-send. */
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
const settings = fs.readFileSync(path.join(root, "src/renderer/settings/index.html"), "utf8");

test("composer is invisible notepad with Keep crafting / Send confirm", () => {
  assert.match(html, /id="messages-composer"/);
  assert.match(html, /messages-composer\.js/);
  assert.match(html, /messages-notepad\.js/);
  assert.match(js, /tinkerMessagesNotepad|tinkerMessagesComposer/);
  assert.match(js, /Keep crafting/);
  assert.match(js, /Send this email\?/);
  assert.match(js, /confirmSend/);
  assert.match(js, /approved_to_send|approve/);
  assert.equal(/data-composer-ship/.test(html), false);
  assert.equal(/data-composer-channel/.test(html), false);
  assert.equal(/>Ship</.test(html), false);
  assert.equal(/\bSend\b/.test(html.match(/id="messages-composer"[\s\S]*?<\/footer>/)[0]), false);
  assert.equal(/sendgrid|MESSAGING_SEND/.test(js), false);
  assert.equal(/\bTyler\b/.test(js + html), false);
});

test("sidebar draft list is gone; outreach settings live on /settings", () => {
  assert.equal(/data-drafts-list/.test(html), false);
  assert.equal(/data-drafts-from/.test(html), false);
  assert.match(settings, /data-drafts-from/);
  assert.match(settings, /data-drafts-booking/);
  assert.match(settings, /data-drafts-sending/);
  assert.match(html, /href="\/settings"/);
  assert.match(draftsJs, /Draft list removed in TYL-65/);
});

test("composer styles stay flat", () => {
  assert.match(css, /\.messages-composer\b/);
  assert.match(css, /messages-notepad-active|writing--in-messages/);
  assert.equal(/\.messages-composer[^{]*\{[^}]*box-shadow/.test(css), false);
});

test("channel and date selectors are not in the composer chrome", () => {
  assert.equal(/data-composer-date-btn/.test(html), false);
  assert.equal(/messages-composer__chips/.test(html), false);
  assert.equal(/type="date"[^>]*class="messages-composer__date-input"/.test(html), false);
  assert.equal(/messages-composer__field--block/.test(html), false);
});
