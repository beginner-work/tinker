/* Unit tests for the beginner-card deposit decoder in transactions.js
 * (window.tinkerTransactions.parseBeginnerDeposit).
 *
 * A backer who fills out beginner's "You are an investor" flow mints a
 * beginner card and deposits it into their tinker wallet; beginner hands the
 * card over as `#deposit=<base64url-json>`. This module decodes that payload
 * into a money-in deposit row for the Money market funds wallet.
 *
 * transactions.js is browser-shaped (touches localStorage, document, window,
 * location). We load it in a vm sandbox with stubs so its bootstrap no-ops and
 * exercise the pure decoder it exposes on window — the same load-the-source
 * approach as membership-row.test.js.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "renderer", "transactions.js"),
  "utf8",
);

function loadModule() {
  const sandbox = {
    Buffer,
    window: {},
    // No location/history/document → redeemBeginnerDeposit() no-ops on load.
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.window.tinkerTransactions;
}

// base64url-encode a payload the way beginner's investor-onboarding.js does.
function encode(obj) {
  return Buffer.from(JSON.stringify(obj), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

test("decodes a valid beginner backing into a money-in deposit", () => {
  const txns = loadModule();
  const row = txns.parseBeginnerDeposit(
    encode({ v: 1, src: "beginner", kind: "backing", name: "Ada Lovelace", label: "Backed beginner", amount: 50000, date: "2026-06-18" }),
  );
  assert.ok(row, "a valid payload decodes");
  assert.equal(row.merchant, "Backed beginner");
  assert.equal(row.amount, 50000, "money in — a positive deposit");
  assert.equal(row.date, "2026-06-18");
  assert.equal(row.category, "beginner");
  assert.equal(row._beginner, true);
  assert.match(row.id, /^t_/, "gets a transaction id");
});

test("a negative amount is still recorded as a money-in deposit", () => {
  const txns = loadModule();
  const row = txns.parseBeginnerDeposit(
    encode({ src: "beginner", amount: -250, date: "2026-01-02" }),
  );
  assert.equal(row.amount, 250, "deposits are absolute — a backing is money in");
});

test("a missing date is stamped with today", () => {
  const txns = loadModule();
  const row = txns.parseBeginnerDeposit(encode({ src: "beginner", amount: 10 }));
  assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/);
});

test("rejects payloads that aren't beginner backings", () => {
  const txns = loadModule();
  assert.equal(txns.parseBeginnerDeposit(encode({ src: "elsewhere", amount: 10 })), null, "wrong source");
  assert.equal(txns.parseBeginnerDeposit(encode({ src: "beginner" })), null, "no amount");
  assert.equal(txns.parseBeginnerDeposit(encode({ src: "beginner", amount: "lots" })), null, "non-numeric amount");
  assert.equal(txns.parseBeginnerDeposit("not-base64-json"), null, "garbage payload");
  assert.equal(txns.parseBeginnerDeposit(""), null, "empty payload");
});

test("deposit() adds a money-in row and notifies subscribers", () => {
  const txns = loadModule();
  let fired = 0;
  txns.subscribe(() => { fired += 1; });
  const before = txns.count();
  const row = txns.deposit({ merchant: "Backed beginner", amount: -9, date: "2026-06-18", category: "beginner" });
  assert.ok(row, "the row is returned");
  assert.equal(row.amount, 9, "stored as money in");
  assert.equal(txns.count(), before + 1, "the wallet grew by one");
  assert.equal(txns.list()[0].merchant, "Backed beginner", "prepended to the list");
  assert.ok(fired >= 1, "subscribers were notified");
});
