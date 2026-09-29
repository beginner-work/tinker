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
const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");

test("body ships messages-shell-open so mobile first paint is never blank", () => {
  assert.match(html, /<body[^>]*class="[^"]*messages-shell-open/);
  assert.match(html, /messages-inbox-primary/);
  assert.match(styles, /body\.messages-shell-open:not\(\.messages-mobile-thread\) \.stage/);
  assert.match(styles, /display:\s*none\s*!important/);
  assert.match(styles, /transform:\s*none\s*!important/);
  assert.match(styles, /height:\s*100dvh\s*!important/);
  assert.match(drawer, /messages-shell-open:not\(\.messages-mobile-thread\)/);
  assert.match(shell, /showCompanyList/);
  assert.match(shell, /enterMobileThread/);
  assert.match(shell, /stayOnList/);
  // Clearing selection must NOT open You / hide the list.
  assert.equal(/if \(id === YOU_ID \|\| !id\) \{ selectYou/.test(shell), false);
  assert.match(sw, /tinker-shell-v11/);
});

test("top-right profile avatar stays hidden", () => {
  assert.match(profile, /corner\.setAttribute\("hidden"/);
  assert.match(html, /profile-corner[\s\S]*hidden/);
  assert.match(profile, /has-avatar/);
  assert.match(profile, /classList\.remove\("has-avatar"\)/);
});
