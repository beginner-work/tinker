/* Mobile inbox must be list-then-thread; drawer must not blank the front screen. */
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

test("body ships messages-shell-open so mobile first paint is never blank", () => {
  assert.match(html, /<body[^>]*class="[^"]*messages-shell-open/);
  assert.match(html, /messages-inbox-primary/);
  assert.match(styles, /body\.messages-shell-open:not\(\.messages-mobile-thread\) \.stage/);
  assert.match(styles, /display:\s*none\s*!important/);
  assert.match(styles, /transform:\s*none\s*!important/);
  assert.match(styles, /height:\s*100dvh\s*!important/);
  assert.match(drawer, /messages-shell-open \.sidebar/);
  assert.match(shell, /showCompanyList/);
  assert.match(shell, /messages-mobile-thread/);
  assert.match(shell, /stayOnList/);
  // Clearing selection must NOT open You / hide the list.
  assert.equal(/if \(id === YOU_ID \|\| !id\) \{ selectYou/.test(shell), false);
});

test("mobile inbox is push navigation with no slide-over drawer", () => {
  assert.equal(/data-messages-menu/.test(html), false);
  assert.match(html, /data-messages-back/);
  assert.match(styles, /body\.messages-shell-open[\s\S]*\.drawer-toggle[\s\S]*display:\s*none\s*!important/);
  assert.equal(/messages-mobile-thread\[data-drawer-open\][\s\S]{0,120}translateX\(0\)/.test(styles), false);
  assert.match(drawer, /transform:\s*none\s*!important/);
  const drawerJs = fs.readFileSync(path.join(root, "src/renderer/mobile-drawer.js"), "utf8");
  assert.match(drawerJs, /inboxOwnsScreen/);
  assert.equal(/data-messages-menu/.test(drawerJs), false);
});

test("top-right profile avatar stays hidden", () => {
  assert.match(profile, /corner\.setAttribute\("hidden"/);
  assert.match(html, /profile-corner[\s\S]*hidden/);
  assert.match(profile, /has-avatar/);
  assert.match(profile, /classList\.remove\("has-avatar"\)/);
});
