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
const composer = fs.readFileSync(path.join(root, "src/renderer/messages-composer.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
const demo = fs.readFileSync(path.join(root, "src/renderer/messages/demo-you.html"), "utf8");

test("pinned You row is always wired above search and due groups", () => {
  assert.match(html, /data-messages-you-slot/);
  assert.match(html, /messages-you\.js/);
  assert.match(shell, /selectYou|YOU_ID|__you__/);
  assert.match(shell, /messages-rail__row--you/);
  assert.match(shell, /renderYouRow/);
});

test("You row and header use Lindow Labs name and logo", () => {
  assert.match(shell, /Lindow Labs/);
  assert.match(shell, /lindow-labs\.svg/);
  assert.match(shell, /OWNER_LABEL|ownerDisplayName/);
  assert.match(shell, /fillOwnerMark|messages-avatar__img/);
  assert.match(html, /data-messages-avatar/);
  assert.match(you, /Lindow Labs/);
  assert.match(you, /lindow-labs\.svg|OWNER_LOGO/);
  assert.match(demo, /Lindow Labs/);
  assert.match(demo, /lindow-labs\.svg/);
  assert.equal(/story parts with your assistant/i.test(shell), false);
  assert.equal(/story parts with your assistant/i.test(you), false);
  assert.equal(/Story parts and drafts with your assistant/i.test(shell), false);
  assert.equal(/GTM approach/i.test(demo), false);
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
  assert.equal(/—/.test(demo), false);
});

test("You composer labels are This is everything / Keep crafting", () => {
  assert.match(composer, /This is everything/);
  assert.match(composer, /Keep crafting/);
  assert.match(composer, /syncActionLabels/);
  assert.match(composer, /youMode \? "This is everything" : "Ship"/);
  assert.match(composer, /youMode \? "Keep crafting" : "Next"/);
  assert.match(demo, /This is everything/);
  assert.match(demo, /Keep crafting/);
  assert.equal(/—/.test(demo), false);
});
