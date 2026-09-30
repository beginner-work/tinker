/* TYL-65 polish: meta in bubbles, quiet header links, fonts. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const thread = fs.readFileSync(path.join(root, "src/renderer/messages-thread.js"), "utf8");
const composer = fs.readFileSync(path.join(root, "src/renderer/messages-composer.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");

test("thread meta lives inside the bubble as one line", () => {
  assert.match(thread, /metaLine|messages-thread__meta/);
  assert.match(thread, /bubble\.appendChild\(meta\)/);
  assert.equal(/You save drafts here/.test(thread + html), false);
  assert.equal(/never sends/i.test(thread), false);
  assert.equal(/—/.test(thread.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")), false);
});

test("slim header with quiet profile links next to the name", () => {
  assert.match(html, /data-messages-name/);
  assert.match(html, /data-messages-role/);
  assert.match(html, /data-messages-links/);
  assert.match(thread, /renderProfileLinks/);
  assert.match(css, /\.messages-pane__link\b/);
  assert.equal(/messages-pane__sub/.test(html), false);
  assert.equal(/You save drafts here/.test(html), false);
  const visible = html.replace(/<!--[\s\S]*?-->/g, "");
  assert.equal(/never sends/i.test(visible), false);
});

test("composer uses Keep crafting / This is everything (no Ship chrome)", () => {
  assert.match(composer, /This is everything/);
  assert.match(composer, /Keep crafting/);
  assert.match(composer, /function keepCrafting/);
  assert.equal(/data-composer-date-btn/.test(html), false);
  assert.equal(/class="messages-composer__date-input"/.test(html), false);
});

test("title fonts use Instrument Sans via --font-sans", () => {
  assert.match(css, /\.messages-rail__title\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
  assert.match(css, /\.messages-rail__name\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
  assert.match(css, /\.messages-pane__title\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
  assert.match(css, /\.messages-rail__group-head\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
});

test("person header wraps name then title; no clamp or ellipsis fade", () => {
  assert.match(html, /messages-pane__name/);
  assert.match(css, /\.messages-pane__title\s*\{[^}]*flex-direction:\s*column/);
  assert.match(css, /\.messages-pane__name\s*\{/);
  assert.match(css, /\.messages-pane__role\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.equal(/\.messages-pane__title\s*\{[^}]*-webkit-line-clamp\s*:\s*\d/.test(css), false);
  assert.equal(/\.messages-pane__title\s*\{[^}]*text-overflow:\s*ellipsis/.test(css), false);
  const shell = fs.readFileSync(path.join(root, "src/renderer/messages-shell.js"), "utf8");
  const thread = fs.readFileSync(path.join(root, "src/renderer/messages-thread.js"), "utf8");
  assert.equal(/" · " \+/.test(shell), false);
  assert.equal(/" · " \+/.test(thread), false);
});
