/* TYL-65: chat bubbles in the thread. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const js = fs.readFileSync(path.join(root, "src/renderer/messages-thread.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const composer = fs.readFileSync(path.join(root, "src/renderer/messages-composer.js"), "utf8");

test("thread maps handed-off and lead reply sides; sent bubbles are UI-hidden", () => {
  assert.match(js, /item--owner|side:\s*"owner"/);
  assert.match(js, /side:\s*"lead"/);
  assert.match(js, /kind:\s*"handed"|Handed off/);
  assert.match(js, /sent_by_owner/);
  assert.match(js, /Handed off/);
  // Sent outreach no longer renders a "Sent via …" bubble in the thread.
  assert.equal(/Sent via/.test(js), false);
  assert.match(js, /messages-thread__meta/);
  assert.match(js, /\bReply\b/);
  assert.match(js, /isInboundDraft|fromLead|direction/);
  assert.match(js, /groupKey|grouped/);
  assert.match(js, /renderProfileLinks/);
  assert.equal(/\bSend\b/.test(js.replace(/Send failed/g, "")), false);
  assert.equal(/\bTyler\b/.test(js), false);
});

test("person writing uses Keep crafting / This is everything (no Ship/Send)", () => {
  assert.match(html, /id="messages-composer"/);
  assert.match(composer, /This is everything/);
  assert.match(composer, /Keep crafting/);
  assert.match(composer, /function keepCrafting/);
  assert.equal(/>Ship</.test(html), false);
  assert.equal(/\bSend\b/.test(html.match(/id="messages-composer"[\s\S]*?<\/footer>/)[0]), false);
});

test("formatDay uses the viewer local timezone (no UTC override)", () => {
  assert.match(js, /function formatDay/);
  assert.match(js, /toLocaleString\(undefined/);
  assert.equal(/timeZone:\s*["']UTC["']/.test(js), false);
  const formatted = new Date("2026-09-29T22:57:00.000Z").toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  assert.match(formatted, /3:57\s*PM/);
  assert.equal(/10:57/.test(formatted), false);
});

test("bubble styles: solid sent right, draft tint, lead left", () => {
  assert.match(css, /\.messages-thread__item--owner\b/);
  assert.match(css, /\.messages-thread__item--lead\b/);
  assert.match(css, /\.messages-thread__item--sent\b/);
  assert.match(css, /\.messages-thread__item--draft\b/);
  assert.match(css, /align-self:\s*flex-end/);
  assert.match(css, /align-self:\s*flex-start/);
  assert.match(css, /messages-thread__meta/);
  assert.match(css, /border-radius:\s*16px/);
  assert.equal(/\.messages-thread__list[^{]*\{[^}]*box-shadow/.test(css), false);
});
