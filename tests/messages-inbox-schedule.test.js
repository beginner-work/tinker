/* Inbox shows outreach plan by company priority (no /schedule page). */
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

test("sidebar groups conversations by company priority", () => {
  assert.match(shell, /groupByCompany/);
  assert.match(shell, /companyRank|companiesById/);
  assert.match(shell, /CONTACT_LABEL/);
  assert.match(shell, /action=inbox|scheduleApi\("inbox"\)/);
  assert.match(shell, /eng leader note/);
  assert.match(shell, /recruiter note/);
  assert.match(shell, /referral intro|referral_outreach/);
  assert.equal(/href=["']\/schedule["']/.test(shell), false);
  assert.match(shell, /\/api\/schedule/);
  assert.match(shell, /leadsApi\("companies"/);
});

test("thread shows a scheduled draft bubble and composer has a date chip", () => {
  assert.match(thread, /messages-thread__item--scheduled/);
  assert.match(thread, /Scheduled/);
  assert.match(html, /data-composer-date/);
  assert.match(composer, /savePlannedDate/);
  assert.match(composer, /nudge-date/);
});

test("no /schedule page is wired in the app shell", () => {
  assert.equal(/href="\/schedule"/.test(html), false);
  assert.equal(fs.existsSync(path.join(root, "src/renderer/schedule/index.html")), false);
});
