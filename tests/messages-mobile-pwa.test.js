/* Mobile inbox must be list-then-thread; drawer must not half-cover the thread. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const styles = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
const drawer = fs.readFileSync(path.join(root, "src/renderer/mobile-drawer.css"), "utf8");
const shell = fs.readFileSync(path.join(root, "src/renderer/messages-shell.js"), "utf8");
const profile = fs.readFileSync(path.join(root, "src/renderer/profile.js"), "utf8");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");

test("messages-shell-open overrides the hamburger drawer on mobile", () => {
  assert.match(styles, /body\.messages-shell-open \.sidebar/);
  assert.match(styles, /transform:\s*none\s*!important/);
  assert.match(styles, /drawer-toggle/);
  assert.match(drawer, /body\.messages-shell-open \.sidebar/);
  assert.match(drawer, /transform:\s*none\s*!important/);
  assert.match(styles, /safe-area-inset-top/);
  assert.match(shell, /messages-mobile-thread/);
  assert.match(shell, /data-messages-back|messages-pane__back/);
});

test("top-right profile avatar stays hidden", () => {
  assert.match(profile, /corner\.setAttribute\("hidden"/);
  assert.match(html, /profile-corner[\s\S]*hidden/);
  assert.match(profile, /has-avatar/);
  assert.match(profile, /classList\.remove\("has-avatar"\)/);
});
