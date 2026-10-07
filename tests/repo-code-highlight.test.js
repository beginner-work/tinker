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

test("CM source includes a vivid light IDE highlight theme", () => {
  assert.match(src, /#d73a49/); // keywords
  assert.match(src, /#005cc5/); // numbers / keys
  assert.match(src, /#032f62/); // strings
  assert.match(src, /#6a737d/); // comments
  assert.match(src, /#6f42c1/); // functions
});

test("CM source implements hybrid markdown live preview decorations", () => {
  assert.match(src, /function markdownLivePreview/);
  assert.match(src, /cm-md-mark/);
  assert.match(src, /cm-md-heading/);
  assert.match(src, /cm-md-inline-code/);
  assert.match(src, /cm-md-link/);
  assert.match(src, /cm-md-quote/);
  assert.match(src, /cm-md-list/);
});

test("vendored CM IIFE is present and exposes create", () => {
  assert.match(vendor, /tinkerCodeMirror/);
  assert.ok(vendor.length > 100000, "vendor bundle should include CM + languages");
  assert.match(vendor, /create/);
});
