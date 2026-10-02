/* UI polish: owner initials paint, sidebar padding, writing affordances. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const shell = fs.readFileSync(path.join(root, "src/renderer/messages-shell.js"), "utf8");
const you = fs.readFileSync(path.join(root, "src/renderer/messages-you.js"), "utf8");
const writing = fs.readFileSync(path.join(root, "src/renderer/writing.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const demo = fs.readFileSync(path.join(root, "src/renderer/messages/demo-owner-parity.html"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const marker = fs.readFileSync(path.join(root, ".release-version"), "utf8").trim();

test("owner initials use an inner span + data-initials (Electron paint-safe)", () => {
  assert.match(shell, /messages-rail__initials/);
  assert.match(shell, /data-initials/);
  assert.match(shell, /createElement\(\s*["']span["']\s*\)/);
  assert.match(shell, /fillOwnerMark:\s*fillOwnerMark/);
  assert.match(you, /fillOwnerMark|messages-rail__initials/);
  // Bare textContent on the avatar node is not the paint path anymore.
  assert.doesNotMatch(
    shell,
    /node\.textContent\s*=\s*text;\s*\n\s*node\.setAttribute\(\s*["']aria-hidden/
  );
  assert.match(css, /\.messages-rail__initials\s*\{/);
  assert.match(
    css,
    /\.messages-rail__avatar\.messages-rail__avatar--fallback[\s\S]*overflow:\s*visible/
  );
  assert.match(
    css,
    /\.messages-pane__avatar\.messages-rail__avatar--fallback[\s\S]*overflow:\s*visible/
  );
  assert.match(css, /transform:\s*translateZ\(0\)/);
});

test("fillInitials paints TL for Tyler Lindow into a real DOM node", () => {
  function FakeEl(tag) {
    this.tagName = String(tag).toUpperCase();
    this.className = "";
    this.attributes = {};
    this.children = [];
    this.hidden = false;
    this.textContent = "";
    this.innerHTML = "";
  }
  Object.defineProperty(FakeEl.prototype, "classList", {
    get() {
      const owner = this;
      return {
        add(...names) {
          const cur = new Set(String(owner.className || "").split(/\s+/).filter(Boolean));
          names.forEach((n) => cur.add(n));
          owner.className = Array.from(cur).join(" ");
        },
        remove(...names) {
          const cur = new Set(String(owner.className || "").split(/\s+/).filter(Boolean));
          names.forEach((n) => cur.delete(n));
          owner.className = Array.from(cur).join(" ");
        },
      };
    },
  });
  FakeEl.prototype.setAttribute = function (k, v) { this.attributes[k] = String(v); };
  FakeEl.prototype.getAttribute = function (k) { return this.attributes[k]; };
  FakeEl.prototype.removeAttribute = function (k) { delete this.attributes[k]; };
  FakeEl.prototype.appendChild = function (child) {
    this.children.push(child);
    if (child && child.textContent) this.textContent = (this.textContent || "") + child.textContent;
    return child;
  };

  const personMatch = shell.match(/function personInitials\(name\) \{[\s\S]*?\n  \}/);
  const fillMatch = shell.match(/function fillInitials\(node, letters\) \{[\s\S]*?\n  \}/);
  assert.ok(personMatch, "personInitials missing");
  assert.ok(fillMatch, "fillInitials missing");
  const sandbox = {
    document: {
      createElement(tag) { return new FakeEl(tag); },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    personMatch[0] + "\n" + fillMatch[0]
      + "\nthis.personInitials=personInitials;this.fillInitials=fillInitials;",
    sandbox
  );

  const letters = sandbox.personInitials("Tyler Lindow");
  assert.equal(letters, "TL");
  const node = new FakeEl("span");
  node.className = "messages-rail__avatar";
  sandbox.fillInitials(node, letters);
  assert.match(node.className, /messages-rail__avatar--fallback/);
  assert.equal(node.getAttribute("data-initials"), "TL");
  assert.equal(node.hidden, false);
  assert.equal(node.children.length, 1);
  assert.equal(node.children[0].className, "messages-rail__initials");
  assert.equal(node.children[0].textContent, "TL");
});

test("sidebar INBOX / empty-state share the ~14px left edge; empty copy is quiet", () => {
  assert.match(css, /\.messages-rail__head\s*\{[^}]*padding:\s*0 14px/);
  assert.match(css, /\.messages-rail__empty[\s\S]*?font-size:\s*11px/);
  assert.match(css, /\.messages-rail__empty[\s\S]*?opacity:\s*0\.85/);
  assert.match(shell, /No people yet\./);
  assert.doesNotMatch(shell, /lead tools/);
  assert.match(html, /No people yet\./);
  assert.doesNotMatch(html, /lead tools|Add a lead on Leads/);
  assert.match(demo, /No people yet\./);
});

test("writing placeholders are muted Start writing...; answer blocks are not huge", () => {
  assert.match(writing, /placeholder\s*=\s*["']Start writing\.\.\./);
  assert.match(
    css,
    /body\.messages-you-active[\s\S]*writing-input::placeholder[\s\S]*color:\s*var\(--color-muted/
  );
  assert.doesNotMatch(
    css,
    /body\.messages-you-active[\s\S]*writing-input::placeholder[\s\S]*color:\s*transparent/
  );
  assert.match(
    css,
    /body\.messages-you-active \.writing--in-messages \.writing-input\s*\{[\s\S]*?min-height:\s*2\.75em/
  );
  assert.match(
    css,
    /body\.messages-you-active \.writing--in-messages \.writing-card\s*\{[\s\S]*?min-height:\s*0/
  );
  assert.doesNotMatch(css, /min-height:\s*min\(70vh/);
  assert.doesNotMatch(
    css,
    /body\.messages-you-active \.writing--in-messages \.writing-input\s*\{[\s\S]*?min-height:\s*50vh/
  );
});

test("writing pane scrollbar is thin overlay; Settings has no hairline divider", () => {
  assert.match(css, /scrollbar-width:\s*thin/);
  assert.match(css, /scrollbar-color:\s*transparent transparent/);
  assert.match(css, /\.writing__body:hover::-webkit-scrollbar-thumb/);
  assert.match(
    css,
    /\.sidebar--inbox \.sidebar__footer[\s\S]*border-top:\s*0/
  );
  assert.match(
    css,
    /\.sidebar--inbox \.sidebar__footer--gear[\s\S]*border:\s*0|\.sidebar--inbox \.sidebar__footer[\s\S]*border:\s*0/
  );
});

test("pane header avatar is a readable circular initials mark, not a clipped L", () => {
  assert.match(
    css,
    /\.messages-pane__avatar\s*\{[\s\S]*?width:\s*28px[\s\S]*?border-radius:\s*50%/
  );
  assert.doesNotMatch(
    css,
    /\.messages-pane__avatar\s*\{[^}]*width:\s*18px[^}]*border-radius:\s*0/
  );
  assert.match(demo, /data-initials="TL"/);
  assert.match(demo, /messages-rail__initials">TL</);
});

test("release marker is 0.1.7", () => {
  assert.equal(marker, "0.1.7");
  assert.equal(pkg.version, "0.1.7");
});
