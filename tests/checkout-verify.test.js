/* Smoke tests for api/checkout/verify.js — fetches the Stripe Checkout
 * Session via STRIPE_SECRET_KEY, validates payment + ownership, and
 * upserts the TinkerUserData row. We stub Stytch, the stripe lib,
 * and Prisma so the test stays in-process.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const path = require("node:path");
const Module = require("node:module");

let stytchUserId = "user-stytch-xyz";
let stytchShouldThrow = null;
let retrieveReturn = null;
let retrieveShouldThrow = null;
const prismaCalls = [];
const fakeStore = new Map();

const stytchStub = {
  authenticateSession: async () => {
    if (stytchShouldThrow) throw stytchShouldThrow;
    return { session: { user_id: stytchUserId } };
  },
};
const stripeStub = {
  retrieveCheckoutSession: async (id) => {
    if (retrieveShouldThrow) throw retrieveShouldThrow;
    return { id, ...retrieveReturn };
  },
  createCheckoutSession: async () => ({}),
};
const dbStub = {
  tinkerUserData: {
    upsert: async ({ where: { userId_kind: { userId, kind } }, create, update }) => {
      prismaCalls.push(["upsert", userId, kind, update.data]);
      const row = { userId, kind, data: update.data ?? create.data, updatedAt: new Date() };
      fakeStore.set(`${userId}::${kind}`, row);
      return row;
    },
    findUnique: async () => null,
    update: async () => null,
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
stubAt(path.join(libDir, "stripe.js"), stripeStub);
stubAt(path.join(libDir, "db.js"), dbStub);

const handler = require("../api/checkout/verify.js");

function fakeReq({ method = "POST", headers = {}, body } = {}) {
  const raw = body == null ? "" : JSON.stringify(body);
  const stream = Readable.from(raw ? [Buffer.from(raw)] : []);
  Object.assign(stream, { headers, method });
  return stream;
}
function fakeRes() {
  const captured = { status: null, body: null };
  return {
    captured,
    setHeader() {},
    status(s) { captured.status = s; return this; },
    json(b) { captured.body = b; return this; },
  };
}

function reset() {
  stytchUserId = "user-stytch-xyz";
  stytchShouldThrow = null;
  retrieveReturn = null;
  retrieveShouldThrow = null;
  prismaCalls.length = 0;
  fakeStore.clear();
}

test("activates the row when payment_status is paid and the session belongs to the caller", async () => {
  reset();
  retrieveReturn = {
    payment_status: "paid",
    client_reference_id: "user-stytch-xyz",
    subscription: "sub_test_1",
  };
  const res = fakeRes();
  await handler(
    fakeReq({
      headers: { authorization: "Bearer t1", "content-type": "application/json" },
      body: { sessionId: "cs_test_abc" },
    }),
    res,
  );
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.tier, "preseed");
  assert.equal(res.captured.body.status, "active");
  const row = fakeStore.get("user-stytch-xyz::subscription");
  assert.ok(row);
  assert.equal(row.data.tier, "preseed");
  assert.equal(row.data.status, "active");
  assert.equal(row.data.source, "checkout-verify");
  assert.equal(row.data.stripeRef, "cs_test_abc");
  assert.equal(row.data.subscriptionId, "sub_test_1");
});

test("refuses with 402 when the session is not paid", async () => {
  reset();
  retrieveReturn = { payment_status: "unpaid", client_reference_id: "user-stytch-xyz" };
  const res = fakeRes();
  await handler(
    fakeReq({
      headers: { authorization: "Bearer t1", "content-type": "application/json" },
      body: { sessionId: "cs_test_abc" },
    }),
    res,
  );
  assert.equal(res.captured.status, 402);
  assert.equal(prismaCalls.length, 0);
});

test("refuses with 403 when the session belongs to a different founder", async () => {
  reset();
  retrieveReturn = { payment_status: "paid", client_reference_id: "user-stytch-OTHER" };
  const res = fakeRes();
  await handler(
    fakeReq({
      headers: { authorization: "Bearer t1", "content-type": "application/json" },
      body: { sessionId: "cs_test_abc" },
    }),
    res,
  );
  assert.equal(res.captured.status, 403);
  assert.equal(prismaCalls.length, 0);
});

test("rejects malformed sessionId with 400", async () => {
  reset();
  const res = fakeRes();
  await handler(
    fakeReq({
      headers: { authorization: "Bearer t1", "content-type": "application/json" },
      body: { sessionId: "not-a-session" },
    }),
    res,
  );
  assert.equal(res.captured.status, 400);
});

test("returns 401 when the bearer token is rejected", async () => {
  reset();
  stytchShouldThrow = Object.assign(new Error("Session expired."), { status: 401 });
  const res = fakeRes();
  await handler(
    fakeReq({
      headers: { authorization: "Bearer bad", "content-type": "application/json" },
      body: { sessionId: "cs_test_abc" },
    }),
    res,
  );
  assert.equal(res.captured.status, 401);
});

test("rejects non-POST methods with 405", async () => {
  reset();
  const res = fakeRes();
  await handler({ method: "GET", headers: {}, on() {} }, res);
  assert.equal(res.captured.status, 405);
});

test("surfaces Stripe API errors with the upstream status code", async () => {
  reset();
  retrieveShouldThrow = Object.assign(new Error("not found"), { status: 404 });
  const res = fakeRes();
  await handler(
    fakeReq({
      headers: { authorization: "Bearer t1", "content-type": "application/json" },
      body: { sessionId: "cs_test_abc" },
    }),
    res,
  );
  assert.equal(res.captured.status, 404);
});
