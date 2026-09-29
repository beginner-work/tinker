/* Tinker is free: membership.js exposes a blank free view and no plan footer. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "renderer", "membership.js"),
  "utf8",
);
const HTML = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "renderer", "index.html"),
  "utf8",
);

function loadFormatter() {
  const sandbox = {
    window: {},
    document: {
      readyState: "complete",
      getElementById() { return null; },
      addEventListener() {},
    },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  sandbox.window.addEventListener = () => {};
  sandbox.window.location = { pathname: "/", origin: "https://tinker.app" };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.window.tinkerMembership.formatMembership;
}

test("sidebar has no plan footer, pause, or restore membership chrome", () => {
  assert.equal(/nav-membership/.test(HTML), false);
  assert.equal(/nav-membership-pause/.test(HTML), false);
  assert.equal(/nav-membership-restore/.test(HTML), false);
  assert.equal(/Pre-seed/.test(HTML), false);
  assert.equal(/\$9\/mo/.test(HTML), false);
  assert.equal(/Pause membership/.test(HTML), false);
});

test("formatMembership is a blank free view with no price or pause", () => {
  const formatMembership = loadFormatter();
  for (const status of [
    null,
    {},
    { active: true, tier: "pre-seed", status: "active", currentPeriodEnd: 1782000000 },
    { active: false, tier: "pre-seed", status: "paused" },
  ]) {
    const view = formatMembership(status);
    assert.equal(view.active, false);
    assert.equal(view.label, "");
    assert.equal(view.sub, "");
    assert.equal(view.cta, "");
    assert.equal(view.restore, false);
    assert.equal(view.pause, "");
  }
  assert.equal(/\$9/.test(SRC), false);
  assert.equal(/Pre-seed/.test(SRC), false);
  assert.equal(/Pause membership/.test(SRC), false);
  assert.equal(/—/.test(SRC), false);
});
