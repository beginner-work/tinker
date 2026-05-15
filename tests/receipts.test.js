/* Smoke tests for api/receipts/index.js — the GET /api/receipts list
 * endpoint. Stubs Stytch and Prisma so the test stays in-process and
 * doesn't touch the network or the database.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

// ── Stubs (installed before requiring receipts handler) ────────────────
const stytchCalls = [];
let stytchShouldThrow = null;
let fakeRows = [];

const stytchStub = {
  authenticateSession: async (token) => {
    stytchCalls.push(token);
    if (stytchShouldThrow) throw stytchShouldThrow;
    return { session: { user_id: "user-test" }, user: { user_id: "user-test" } };
  },
};
const dbStub = {
  receipt: {
    findMany: async () => fakeRows,
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

const handler = require("../api/receipts/index.js");

// ── Helpers ────────────────────────────────────────────────────────────
function fakeReq({ method = "GET", headers = {} } = {}) {
  return { method, headers };
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
  stytchCalls.length = 0;
  stytchShouldThrow = null;
  fakeRows = [];
}

// ── Tests ──────────────────────────────────────────────────────────────

test("GET returns receipts mapped to summary rows with computed totals", async () => {
  reset();
  fakeRows = [
    {
      id: "1",
      date: "April 17, 2026",
      maker: "Hāpi by Tyler",
      makerLocation: "San Diego, CA 92102",
      customer: "Benjamin Edmonds",
      items: [{ name: "Hop tincture", qty: 1, price: 25 }],
      acct: "ACCT 92102 •••• •••• 0001",
    },
    {
      id: "2",
      date: "April 18, 2026",
      maker: "92102 community fund",
      makerLocation: "San Diego, CA 92102",
      customer: "Lucas Cooper-Bey",
      items: [
        { name: "Workshop", qty: 2, price: 50 },
        { name: "Materials", qty: 1, price: 10 },
      ],
      acct: "STRIPE 92102 •••• •••• 0002",
    },
  ];

  const res = fakeRes();
  await handler(fakeReq({ headers: { authorization: "Bearer t1" } }), res);
  assert.equal(res.captured.status, 200);
  assert.deepEqual(stytchCalls, ["t1"]);
  assert.equal(res.captured.body.receipts.length, 2);
  assert.equal(res.captured.body.receipts[0].id, "1");
  assert.equal(res.captured.body.receipts[0].total, 25);
  assert.equal(res.captured.body.receipts[1].total, 110);
  // Summary should not leak raw items / acct.
  assert.equal("items" in res.captured.body.receipts[0], false);
  assert.equal("acct" in res.captured.body.receipts[0], false);
});

test("returns empty list when no receipts exist", async () => {
  reset();
  const res = fakeRes();
  await handler(fakeReq({ headers: { authorization: "Bearer t1" } }), res);
  assert.equal(res.captured.status, 200);
  assert.deepEqual(res.captured.body.receipts, []);
});

test("returns 401 when Stytch rejects the token", async () => {
  reset();
  stytchShouldThrow = Object.assign(new Error("Session expired."), { status: 401 });
  const res = fakeRes();
  await handler(fakeReq({ headers: { authorization: "Bearer expired" } }), res);
  assert.equal(res.captured.status, 401);
  assert.equal(res.captured.body.error, "Session expired.");
});

test("rejects non-GET methods with 405", async () => {
  reset();
  const res = fakeRes();
  await handler(fakeReq({ method: "POST" }), res);
  assert.equal(res.captured.status, 405);
  assert.equal(res.captured.headers["Allow"], "GET");
});

test("non-numeric items are tolerated when computing totals", async () => {
  reset();
  fakeRows = [
    {
      id: "3",
      date: "x",
      maker: "x",
      makerLocation: "x",
      customer: "x",
      items: [{ name: "broken", qty: "two", price: 5 }, { name: "ok", qty: 1, price: 9 }],
      acct: "x",
    },
  ];
  const res = fakeRes();
  await handler(fakeReq({ headers: { authorization: "Bearer t1" } }), res);
  assert.equal(res.captured.status, 200);
  // "two" → NaN qty, dropped from the sum; only the second item counts.
  assert.equal(res.captured.body.receipts[0].total, 9);
});
