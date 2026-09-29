/* Inbox lists people; no /schedule page; no planning bubbles. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const shell = fs.readFileSync(path.join(root, "src/renderer/messages-shell.js"), "utf8");
const thread = fs.readFileSync(path.join(root, "src/renderer/messages-thread.js"), "utf8");
const composer = fs.readFileSync(path.join(root, "src/renderer/messages-composer.js"), "utf8");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");

test("sidebar lists people in THIS WEEK / LATER", () => {
  assert.match(shell, /selectLead/);
  assert.match(shell, /THIS WEEK/);
  assert.match(shell, /LATER/);
  assert.match(shell, /Lindow Labs/);
  assert.match(shell, /TOUCH_LABEL|referral_outreach/);
  assert.match(shell, /action=inbox|scheduleApi\("inbox"\)/);
  assert.equal(/renderPersonTabs/.test(shell), false);
  assert.equal(/href=["']\/schedule["']/.test(shell), false);
});

test("thread has no scheduled planning bubbles; composer has no date chip", () => {
  assert.equal(/messages-thread__item--scheduled/.test(thread), false);
  assert.equal(/renderScheduledBubble/.test(thread), false);
  assert.match(thread, /Queued\. Your assistant will send this through Gmail/);
  assert.equal(/data-composer-date/.test(html), false);
  assert.equal(/savePlannedDate/.test(composer), false);
});

test("no /schedule page is wired in the app shell", () => {
  assert.equal(/href="\/schedule"/.test(html), false);
  assert.equal(fs.existsSync(path.join(root, "src/renderer/schedule/index.html")), false);
});
