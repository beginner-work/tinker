/* Smoke tests for api/transactions.js — the per-user marketplace
 * transactions endpoint. We stub Stytch and Prisma so the test stays
 * in-process and doesn't touch the network or the database.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const path = require("node:path");
const Module = require("node:module");

// ── Stubs ──────────────────────────────────────────────────────────────
let stytchSession = {
  user: { phone_numbers: [{ phone_number: "+16505805788", verified: true }] },
};
let stytchShouldThrow = null;
let queryRawCalls = [];
let queryRawResults = [];

const stytchStub = {
  authenticateSession: async (token) => {
    if (stytchShouldThrow) throw stytchShouldThrow;
    return stytchSession;
  },
};

const dbStub = {
  $queryRaw: async (...args) => {
    queryRawCalls.push(args);
    if (queryRawResults.length === 0) return [];
    return queryRawResults.shift();
  },
};

const libDir = path.resolve(__dirname, "..", "api", "_lib");
function stubAt(absPath, exports) {
  const m = new Module(absPath);
  m.filename = absPath;
  m.loaded = true;
  m.exports = exports;
  require.cache[absPath] = m;
}
stubAt(path.join(libDir, "stytch.js"), stytchStub);
stubAt(path.join(libDir, "db.js"), dbStub);

const handler = require("../api/transactions.js");

// ── Helpers ────────────────────────────────────────────────────────────
function fakeReq({ method = "GET", headers = {} } = {}) {
  const stream = Readable.from([]);
  Object.assign(stream, { headers, method });
  return stream;
}
function fakeRes() {
  const captured = { status: null, body: null, headers: {} };
  return {
    captured,
    setHeader(k, v) { captured.headers[k] = v; },
    status(s) { captured.status = s; return this; },
    json(b) { captured.body = b; return this; },
  };
}
function reset() {
  queryRawCalls = [];
  queryRawResults = [];
  stytchShouldThrow = null;
  stytchSession = {
    user: { phone_numbers: [{ phone_number: "+16505805788", verified: true }] },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

test("rejects non-GET methods with 405", async () => {
  reset();
  const res = fakeRes();
  await handler(fakeReq({ method: "POST", headers: { authorization: "Bearer t1" } }), res);
  assert.equal(res.captured.status, 405);
  assert.equal(res.captured.headers.Allow, "GET");
});

test("returns 401 when Stytch rejects the token", async () => {
  reset();
  stytchShouldThrow = Object.assign(new Error("Session expired."), { status: 401 });
  const res = fakeRes();
  await handler(fakeReq({ headers: { authorization: "Bearer bad" } }), res);
  assert.equal(res.captured.status, 401);
});

test("returns 401 when the session has no phone number", async () => {
  reset();
  stytchSession = { user: { phone_numbers: [] } };
  const res = fakeRes();
  await handler(fakeReq({ headers: { authorization: "Bearer t1" } }), res);
  assert.equal(res.captured.status, 401);
});

test("returns the buyer's transactions with items attached, newest-first", async () => {
  reset();
  const now = new Date("2026-05-15T10:00:00Z");
  const earlier = new Date("2026-05-10T10:00:00Z");
  queryRawResults.push([
    {
      id: "txn_2",
      totalAmount: 24.5,
      status: "PAYMENT_COMPLETED",
      createdAt: now,
      paymentCompletedAt: now,
      merchantName: "Coffee Roaster",
    },
    {
      id: "txn_1",
      totalAmount: 100,
      status: "PAYMENT_PENDING",
      createdAt: earlier,
      paymentCompletedAt: null,
      merchantName: "Whole Foods",
    },
  ]);
  queryRawResults.push([
    { id: "i_1", transactionId: "txn_2", description: "Latte", price: 5.5, quantity: 1 },
    { id: "i_2", transactionId: "txn_2", description: "Pastry", price: 9.5, quantity: 2 },
    { id: "i_3", transactionId: "txn_1", description: "Groceries", price: 100, quantity: 1 },
  ]);

  const res = fakeRes();
  await handler(fakeReq({ headers: { authorization: "Bearer t1" } }), res);

  assert.equal(res.captured.status, 200);
  const body = res.captured.body;
  assert.equal(body.transactions.length, 2);

  assert.equal(body.transactions[0].id, "txn_2");
  assert.equal(body.transactions[0].merchantName, "Coffee Roaster");
  assert.equal(body.transactions[0].totalAmount, 24.5);
  assert.equal(body.transactions[0].createdAt, now.toISOString());
  assert.equal(body.transactions[0].paymentCompletedAt, now.toISOString());
  assert.equal(body.transactions[0].items.length, 2);
  assert.equal(body.transactions[0].items[0].description, "Latte");

  assert.equal(body.transactions[1].id, "txn_1");
  assert.equal(body.transactions[1].paymentCompletedAt, null);
  assert.equal(body.transactions[1].items.length, 1);
});

test("skips the items query when the user has no transactions", async () => {
  reset();
  queryRawResults.push([]); // primary query
  const res = fakeRes();
  await handler(fakeReq({ headers: { authorization: "Bearer t1" } }), res);
  assert.equal(res.captured.status, 200);
  assert.deepEqual(res.captured.body, { transactions: [] });
  assert.equal(queryRawCalls.length, 1, "items query should be skipped on empty list");
});
