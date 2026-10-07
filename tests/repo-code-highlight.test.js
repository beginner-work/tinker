/* Unit tests for /repo CodeMirror language helpers (source contract). */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const src = fs.readFileSync(
  path.join(root, "src/renderer/lib/repo-cm-editor-src.mjs"),
  "utf8",
);
const vendor = fs.readFileSync(
  path.join(root, "src/renderer/vendor/codemirror-repo-editor.min.js"),
  "utf8",
);

test("CM source maps exercise extensions to languages", () => {
  assert.match(src, /ext === "yaml"|ext === "yml"/);
  assert.match(src, /ext === "json"/);
  assert.match(src, /typescript:\s*true/);
  assert.match(src, /ext === "md"|ext === "markdown"/);
  assert.match(src, /function isMarkdownFile/);
  assert.match(src, /function languageFor/);
});

test("CM source includes a vivid multi-hue Light+ theme", () => {
  assert.match(src, /#a31515/); // strings (red — not near-navy)
  assert.match(src, /#0451a5/); // keys / properties
  assert.match(src, /#098658/); // numbers / booleans
  assert.match(src, /#008000/); // comments (green italic)
  assert.match(src, /#0000ff/); // keywords
  assert.match(src, /#267f99/); // types
  assert.match(src, /#795e26/); // functions
  assert.match(src, /#6a737d/); // muted punctuation
  assert.doesNotMatch(src, /syntaxHighlighting\(\s*defaultHighlightStyle/);
});

test("CM source implements hybrid markdown live preview decorations", () => {
  assert.match(src, /function markdownLivePreview/);
  assert.match(src, /RangeSetBuilder/);
  assert.match(src, /cm-md-mark/);
  assert.match(src, /cm-md-heading/);
  assert.match(src, /cm-md-h1/);
  assert.match(src, /1\.6em/);
  assert.match(src, /1\.35em/);
  assert.match(src, /1\.15em/);
  assert.match(src, /cm-md-inline-code/);
  assert.match(src, /cm-md-codeblock/);
  assert.match(src, /cm-md-link/);
  assert.match(src, /cm-md-quote/);
  assert.match(src, /cm-md-list/);
  assert.match(src, /cm-md-strong/);
  assert.match(src, /cm-md-em/);
});

test("vendored CM IIFE is present and exposes create", () => {
  assert.match(vendor, /tinkerCodeMirror/);
  assert.ok(vendor.length > 100000, "vendor bundle should include CM + languages");
  assert.match(vendor, /create/);
});
