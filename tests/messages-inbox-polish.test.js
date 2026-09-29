/* TYL-65 polish after #350 review: meta in bubbles, Ship/Next, fonts, copy. */
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
  assert.equal(/—/.test(thread.replace(/\/\*[\s\S]*?\*\//g, "")), false);
});

test("slim one-line header without third copy line", () => {
  assert.match(html, /data-messages-name/);
  assert.match(html, /data-messages-role/);
  assert.equal(/messages-pane__sub/.test(html), false);
  assert.equal(/You save drafts here/.test(html), false);
  const visible = html.replace(/<!--[\s\S]*?-->/g, "");
  assert.equal(/never sends/i.test(visible), false);
});

test("composer Ship/Next and chip date (no raw date input chrome)", () => {
  assert.match(composer, /saveDraft\("ship"\)|mode === "ship"/);
  assert.match(composer, /approve/);
  assert.match(html, /data-composer-date-btn/);
  assert.match(html, /messages-composer__date-hidden|data-composer-date/);
  assert.match(css, /\.messages-composer__shell\b/);
  assert.equal(/class="messages-composer__date-input"/.test(html), false);
});

test("title fonts use Instrument Sans via --font-sans", () => {
  assert.match(css, /\.messages-rail__title\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
  assert.match(css, /\.messages-rail__name\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
  assert.match(css, /\.messages-pane__title\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
  assert.match(css, /\.messages-rail__group-head\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
});
