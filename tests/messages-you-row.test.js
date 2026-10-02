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

test("desktop home lands on You/self-reflection immediately; mobile stays on list", () => {
  assert.match(shell, /isDesktopHomeWidth|openDesktopYouHome/);
  assert.match(shell, /max-width:\s*720px/);
  // Boot opens You before refresh so the detail pane does not flash empty.
  const bootIdx = shell.indexOf("function boot");
  assert.ok(bootIdx > 0);
  const boot = shell.slice(bootIdx, bootIdx + 2200);
  assert.match(boot, /openDesktopYouHome/);
  assert.match(boot, /selectYou\(\{\s*silent:\s*true,\s*stayOnList:\s*true/);
  // Fresh paint with no selection prefers You on desktop only.
  assert.match(shell, /else if \(!openDesktopYouHome/);
  // Brand/home click re-opens You on desktop; mobile clears to the list.
  assert.match(shell, /openDesktopYouHome\(\{\s*silent:\s*false/);
});

test("You row and header use the owner profile name, not the brand label", () => {
  assert.match(shell, /ownerPersonLabel|ownerPersonName/);
  assert.match(shell, /fillOwnerMark|messages-rail__avatar--fallback/);
  assert.match(html, /data-messages-avatar/);
  // Header prefers profile.name (Tyler Lindow), not OWNER_LABEL / Lindow Labs.
  assert.match(you, /ownerProfile/);
  assert.match(you, /p\.name/);
  assert.equal(/shell\.OWNER_LABEL/.test(you), false);
  assert.match(you, /ownerInitials|messages-rail__avatar--fallback/);
  assert.equal(/createElement\(\s*["']img["']\)/.test(you), false);
  assert.match(you, /purge_plan/);
  assert.match(you, /data-messages-links/);
  assert.match(demo, /Tyler Lindow/);
  assert.match(demo, /sitting here at home/);
  assert.equal(/story parts with your assistant/i.test(shell), false);
  assert.equal(/story parts with your assistant/i.test(you), false);
  assert.equal(/Story parts and drafts with your assistant/i.test(shell), false);
  assert.equal(/Your GTM approach/i.test(demo), false);
  assert.equal(/GTM approach/i.test(demo), false);
});

test("You selection hosts writing notepad inside messages pane", () => {
  assert.match(you, /tinkerMessagesYou/);
  assert.match(you, /writing--in-messages/);
  assert.match(you, /tinkerNewSession|tinkerResumeDraft/);
  assert.match(you, /focusNotepad|labelFloatingActions/);
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

test("You interview question stays full ink contrast; push-nav back, no hamburger", () => {
  assert.match(css, /color:\s*var\(--color-ink/);
  assert.match(
    css,
    /body\.messages-you-active[\s\S]*writing-question[\s\S]*opacity:\s*1/
  );
  // No hamburger clearance — prompt uses normal gutter.
  const mobileYou = css.match(
    /@media \(max-width:\s*540px\)\s*\{[\s\S]*?body\.messages-you-active\.messages-mobile-thread \.writing--in-messages \.writing__body\s*\{([^}]+)\}/
  );
  assert.ok(mobileYou, "expected ≤540px You writing__body rule");
  assert.match(mobileYou[1], /padding-left:\s*12px/);
  assert.equal(/padding-left:\s*68px/.test(mobileYou[1]), false);
  assert.match(html, /data-messages-lead/);
  assert.match(html, /data-messages-back/);
  assert.equal(/data-messages-menu/.test(html), false);
});

test("owner notepad is borderless and floating actions replace composer + mode-nav", () => {
  assert.match(css, /body\.messages-you-active \.writing--in-messages \.writing-input/);
  assert.match(css, /border:\s*0\s*!important/);
  assert.match(css, /background:\s*transparent\s*!important/);
  assert.match(css, /body\.messages-you-active #messages-composer/);
  assert.match(css, /body\.messages-you-active \.mode-nav/);
  assert.match(css, /body\.messages-you-active \.writing--in-messages \.writing__foot/);
  assert.match(css, /position:\s*fixed/);
  assert.match(you, /This is everything/);
  assert.match(you, /Keep crafting/);
  assert.match(demo, /This is everything/);
  assert.match(demo, /Keep crafting/);
  assert.match(demo, /writing-input/);
  assert.equal(/Write a draft/i.test(demo), false);
  assert.equal(/—/.test(demo), false);
  // Lead and You threads share Keep crafting / This is everything.
  assert.match(composer, /This is everything/);
  assert.match(composer, /Keep crafting/);
});
