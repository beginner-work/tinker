/* Inbox lists companies; people open as tabs (no /schedule page). */
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
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");

test("sidebar lists companies and opens person tabs", () => {
  assert.match(shell, /selectCompany/);
  assert.match(shell, /renderPersonTabs|messages-pane__tab/);
  assert.match(shell, /visibleCompanies|leadsForCompany/);
  assert.match(shell, /Lindow Labs/);
  assert.match(shell, /CONTACT_LABEL/);
  assert.match(css, /messages-pane__tabs/);
  assert.match(shell, /action=inbox|scheduleApi\("inbox"\)/);
  assert.equal(/href=["']\/schedule["']/.test(shell), false);
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
