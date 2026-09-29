/* TYL-65 slice 2: thread view per lead. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "src/renderer/messages-thread.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");

test("thread script is wired and listens for conversation select", () => {
  assert.match(html, /messages-thread\.js/);
  assert.match(js, /tinkerMessagesThread/);
  assert.match(js, /tinker:messages-select/);
  assert.match(js, /LinkedIn connection request/);
  assert.match(js, /Gmail/);
  assert.match(js, /LinkedIn DM/);
  assert.match(js, /Draft|sent_by_owner|side:\s*"owner"/);
  assert.match(js, /approved_to_send|queued/);
  assert.equal(/\bTyler\b/.test(js), false);
  assert.equal(/sendgrid|MESSAGING_SEND/.test(js), false);
});

test("thread styles stay flat without nested card boxes", () => {
  assert.match(css, /\.messages-thread__list\b/);
  assert.match(css, /\.messages-thread__bubble\b/);
  assert.match(css, /\.messages-thread__meta\b/);
  assert.equal(/\.messages-thread__list[^{]*\{[^}]*box-shadow/.test(css), false);
  assert.equal(/\.messages-thread__item--owner[^{]*\{[^}]*box-shadow/.test(css), false);
});
