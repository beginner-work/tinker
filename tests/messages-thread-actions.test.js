/* Shared Keep crafting / This is everything action chrome. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const actionsSrc = fs.readFileSync(path.join(root, "src/renderer/messages-thread-actions.js"), "utf8");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const notepad = fs.readFileSync(path.join(root, "src/renderer/messages-notepad.js"), "utf8");
const you = fs.readFileSync(path.join(root, "src/renderer/messages-you.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");

test("shared actions put Keep crafting before This is everything", () => {
  const sandbox = { window: {}, document: { createElement: () => ({}) }, globalThis: {} };
  // Minimal DOM for buildFoot
  sandbox.document.createElement = function (tag) {
    const kids = [];
    const node = {
      tagName: String(tag).toUpperCase(),
      className: "",
      textContent: "",
      hidden: false,
      children: kids,
      appendChild(child) { kids.push(child); return child; },
      addEventListener() {},
      setAttribute() {},
      insertBefore(newNode, ref) {
        const i = kids.indexOf(ref);
        if (i >= 0) kids.splice(i, 0, newNode);
        else kids.push(newNode);
        return newNode;
      },
    };
    return node;
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(actionsSrc, sandbox);
  const api = sandbox.tinkerThreadActions;
  assert.equal(api.PRIMARY_LABEL, "This is everything");
  assert.equal(api.SECONDARY_LABEL, "Keep crafting");
  const built = api.buildFoot({});
  assert.equal(built.foot.children[0], built.secondary);
  assert.equal(built.foot.children[1], built.primary);
  assert.equal(built.secondary.textContent, "Keep crafting");
  assert.equal(built.primary.textContent, "This is everything");
});

test("You footer HTML and notepad share the action module", () => {
  assert.match(html, /messages-thread-actions\.js/);
  assert.match(html, /id="writing-next"[\s\S]*id="writing-end"/);
  assert.equal(/id="writing-end"[\s\S]*id="writing-next"/.test(html), false);
  assert.match(notepad, /tinkerThreadActions/);
  assert.match(you, /tinkerThreadActions|syncWritingFoot/);
  assert.match(sw, /\/messages-thread-actions\.js/);
  // You-mode styles: Keep crafting outlined, This is everything solid.
  assert.match(css, /body\.messages-you-active[\s\S]*writing__next[\s\S]*color-border/);
  assert.match(css, /body\.messages-you-active[\s\S]*writing__end[\s\S]*#4f46e5/);
});

test("thread headers respect safe-area-inset-top in standalone / mobile thread", () => {
  assert.match(css, /display-mode:\s*standalone/);
  assert.match(css, /\.messages-pane__top[\s\S]*safe-area-inset-top/);
  assert.match(css, /body\.messages-mobile-thread \.messages-pane__top[\s\S]*safe-area-inset-top/);
});
