/* TYL-65 slice 1: messaging shell + conversation list. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "src/renderer/messages-shell.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
const funnel = fs.readFileSync(path.join(root, "src/renderer/lead-funnel.js"), "utf8");

test("messages shell chrome is wired in index and script", () => {
  assert.match(html, /id="sidebar-messages"/);
  assert.match(html, /id="messages-pane"/);
  assert.match(html, /messages-shell\.js/);
  assert.match(html, /data-messages-search/);
  assert.match(html, /data-messages-list/);
  assert.match(html, /href="\/leads"/);
  assert.match(js, /tinkerMessagesShell/);
  assert.match(js, /action:\s*["']list["']|action=list|api\(["']list["']/);
  assert.match(js, /Select a conversation|No conversations yet|Needs a draft/);
  assert.equal(/\bTyler\b/.test(js + html), false);
  assert.equal(/sendgrid|MESSAGING_SEND|\bSend\b/.test(js), false);
});

test("conversation list styling is flat (no nested cards)", () => {
  assert.match(css, /\.messages-rail\b/);
  assert.match(css, /\.messages-pane\b/);
  assert.match(css, /messages-shell-open/);
  assert.match(css, /messages-mobile-thread/);
  assert.equal(/\.messages-rail__row[^{]*\{[^}]*box-shadow/.test(css), false);
  assert.equal(/\.messages-pane[^{]*\{[^}]*box-shadow/.test(css), false);
});

test("hunt funnel filters and opens the conversation list", () => {
  assert.match(funnel, /tinkerMessagesShell/);
  assert.match(funnel, /setCompanyFilter/);
  assert.match(funnel, /selectLead/);
});
