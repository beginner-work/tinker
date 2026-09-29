/* TYL-65: people-list messaging shell. */
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
const thread = fs.readFileSync(path.join(root, "src/renderer/messages-thread.js"), "utf8");
const composer = fs.readFileSync(path.join(root, "src/renderer/messages-composer.js"), "utf8");

test("messages shell chrome is wired in index and script", () => {
  assert.match(html, /id="sidebar-messages"/);
  assert.match(html, /id="messages-pane"/);
  assert.match(html, /messages-shell\.js/);
  assert.match(html, /messages-notepad\.js/);
  assert.match(html, /data-messages-list/);
  assert.match(html, /href="\/leads"/);
  assert.match(html, /href="\/settings"/);
  assert.match(js, /tinkerMessagesShell/);
  assert.match(js, /leadsApi\(["']list["']/);
  assert.match(js, /removeAttribute\(["']data-active["']\)/);
  assert.match(css, /body\.messages-shell-open \.mode-nav/);
  assert.equal(/data-messages-search/.test(html), false);
  assert.equal(/Search people or companies/.test(html), false);
  assert.equal(/sendgrid|MESSAGING_SEND/.test(js), false);
});

test("rail is people-list with THIS WEEK / LATER; undated go to LATER", () => {
  assert.match(js, /THIS WEEK/);
  assert.match(js, /LATER/);
  assert.match(js, /No dueDate → LATER|return "LATER"/);
  assert.match(js, /companyPriority/);
  assert.match(js, /queueOrder/);
  assert.match(js, /sortLeadsInBucket/);
  // No company person-tabs chrome.
  assert.equal(/renderPersonTabs/.test(js), false);
  assert.match(js, /selectLead/);
  assert.match(js, /selectYou/);
});

test("no initials monograms; company logo only when resolved; owner keeps photo", () => {
  assert.match(js, /hideOnFail:\s*true/);
  assert.match(js, /No monogram fallback/);
  assert.match(js, /fillOwnerMark/);
  assert.match(js, /ownerAvatarUrl/);
  assert.equal(/messages-rail__avatar--fallback/.test(js) && /textContent = personInitials/.test(js), false);
});

test("thread has no scheduled planning bubbles", () => {
  assert.equal(/renderScheduledBubble/.test(thread), false);
  assert.equal(/Write the draft below/.test(thread), false);
  assert.match(thread, /Handed off\. Your assistant will send this/);
  assert.match(thread, /Sent via/);
});

test("person chat header shows quiet LinkedIn and GitHub links when URLs exist", () => {
  assert.match(html, /data-messages-links/);
  assert.match(thread, /renderProfileLinks/);
  assert.match(thread, /githubUrl/);
  assert.match(thread, /linkedInUrl/);
  assert.match(thread, /target:\s*["_']_blank["_']/);
  assert.match(css, /\.messages-pane__link\b/);
  const demo = fs.readFileSync(path.join(root, "src/renderer/messages/demo-people-header.html"), "utf8");
  assert.match(demo, /data-messages-links/);
  assert.match(demo, /LinkedIn/);
  assert.match(demo, /GitHub/);
  assert.equal(/messages-rail__search/.test(demo), false);
});

test("lead composer is invisible notepad with Keep crafting / This is everything", () => {
  assert.match(composer, /tinkerMessagesNotepad/);
  assert.match(composer, /This is everything/);
  assert.match(composer, /Keep crafting/);
  assert.match(composer, /approved_to_send|approve/);
  assert.equal(/data-composer-channel/.test(html), false);
  assert.equal(/No story parts yet/.test(html), false);
});

test("conversation list styling is flat (no nested cards)", () => {
  assert.match(css, /\.messages-rail\b/);
  assert.match(css, /\.messages-pane\b/);
  assert.match(css, /messages-shell-open/);
  assert.match(css, /messages-mobile-thread/);
  assert.equal(/\.messages-rail__row[^{]*\{[^}]*box-shadow/.test(css), false);
  assert.equal(/\.messages-pane[^{]*\{[^}]*box-shadow/.test(css), false);
});

test("hunt funnel still opens a person conversation", () => {
  assert.match(funnel, /tinkerMessagesShell/);
  assert.match(funnel, /setCompanyFilter/);
  assert.match(funnel, /selectLead/);
});
