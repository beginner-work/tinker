/* TYL-65: pinned You row opens guided writing inside the chat layout. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const shell = fs.readFileSync(path.join(root, "src/renderer/messages-shell.js"), "utf8");
const you = fs.readFileSync(path.join(root, "src/renderer/messages-you.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");

test("pinned You row is always wired above search and due groups", () => {
  assert.match(html, /data-messages-you-slot/);
  assert.match(html, /messages-you\.js/);
  assert.match(shell, /selectYou|YOU_ID|__you__/);
  assert.match(shell, /messages-rail__row--you/);
  assert.match(shell, /renderYouRow/);
  assert.match(shell, /Story parts and drafts with your assistant/);
});

test("You selection hosts writing interview inside messages pane", () => {
  assert.match(you, /tinkerMessagesYou/);
  assert.match(you, /writing--in-messages/);
  assert.match(you, /tinkerNewSession|tinkerResumeDraft/);
  assert.match(you, /tinker:messages-you-action/);
  assert.match(css, /messages-you-active/);
  assert.match(css, /writing--in-messages/);
});

test("You-mode writing sits in normal flow under the pane header", () => {
  const block = css.match(/body\.messages-you-active \.writing--in-messages\s*\{[^}]+\}/);
  assert.ok(block, "expected writing--in-messages rule");
  assert.match(block[0], /position:\s*relative/);
  assert.match(block[0], /inset:\s*auto/);
  assert.equal(/—/.test(you), false);
  const demo = fs.readFileSync(path.join(root, "src/renderer/messages/demo-you.html"), "utf8");
  assert.equal(/—/.test(demo), false);
});
