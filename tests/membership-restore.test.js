/* Tinker is free: restore / plan-footer UI is gone from membership.js. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "renderer", "membership.js"),
  "utf8",
);
const HTML = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "renderer", "index.html"),
  "utf8",
);

test("sidebar no longer wires Restore or a priced membership row", () => {
  assert.equal(/nav-membership-restore/.test(HTML), false);
  assert.equal(/nav-membership["\s>]/.test(HTML), false);
  assert.equal(/Already subscribed/.test(SRC), false);
  assert.equal(/startReconcile|startCheckout|startPause/.test(SRC), false);
  assert.equal(/Pre-seed · \$9\/mo/.test(SRC), false);
  assert.equal(/\$9\/mo/.test(SRC), false);
  assert.match(SRC, /claimParkedPass|tinker_pass_claim/);
});
