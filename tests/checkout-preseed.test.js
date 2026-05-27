/* Smoke tests for api/checkout/preseed.js — creates a Stripe Checkout
 * Session pinned to the calling founder's Stytch user_id and returns
 * its hosted URL. We stub Stytch + the stripe lib so the test stays
 * in-process and never reaches the Stripe API.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

let stytchUserId = "user-stytch-xyz";
let stytchShouldThrow = null;
const createCalls = [];
let createShouldThrow = null;
let createReturn = { url: "https://checkout.stripe.com/c/pay/cs_test_abc" };

const stytchStub = {
  authenticateSession: async () => {
    if (stytchShouldThrow) throw stytchShouldThrow;
    return { session: { user_id: stytchUserId } };
  },
};
const stripeStub = {
  createCheckoutSession: async (args) => {
    createCalls.push(args);
    if (createShouldThrow) throw createShouldThrow;
    return createReturn;
  },
  retrieveCheckoutSession: async () => ({}),
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

const handler = require("../api/checkout/preseed.js");

function fakeReq({ method = "POST", headers = {} } = {}) {
  return { method, headers, on() {} };
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
  createCalls.length = 0;
  createShouldThrow = null;
  createReturn = { url: "https://checkout.stripe.com/c/pay/cs_test_abc" };
}

test("POST returns the Stripe-issued session URL", async () => {
  reset();
  const res = fakeRes();
  await handler(fakeReq({ headers: { authorization: "Bearer t1", host: "tinker.example" } }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.url, "https://checkout.stripe.com/c/pay/cs_test_abc");
});

test("creates the session with the Stytch user id as client_reference_id and a literal CHECKOUT_SESSION_ID placeholder", async () => {
  reset();
  const res = fakeRes();
  await handler(fakeReq({ headers: { authorization: "Bearer t1", host: "tinker.example" } }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].userId, "user-stytch-xyz");
  assert.equal(
    createCalls[0].successUrl,
    "https://tinker.example/?stripe_session_id={CHECKOUT_SESSION_ID}",
  );
});

test("uses the x-forwarded-host + proto when behind Vercel's proxy", async () => {
  reset();
  const res = fakeRes();
  await handler(
    fakeReq({
      headers: {
        authorization: "Bearer t1",
        host: "internal",
        "x-forwarded-host": "preview-abc.vercel.app",
        "x-forwarded-proto": "https",
      },
    }),
    res,
  );
  assert.equal(createCalls[0].successUrl, "https://preview-abc.vercel.app/?stripe_session_id={CHECKOUT_SESSION_ID}");
});

test("rejects non-POST methods with 405", async () => {
  reset();
  const res = fakeRes();
  await handler(fakeReq({ method: "GET" }), res);
  assert.equal(res.captured.status, 405);
});

test("returns 401 when the bearer token is rejected by Stytch", async () => {
  reset();
  stytchShouldThrow = Object.assign(new Error("Session expired."), { status: 401 });
  const res = fakeRes();
  await handler(fakeReq({ headers: { authorization: "Bearer bad", host: "tinker.example" } }), res);
  assert.equal(res.captured.status, 401);
});

test("surfaces Stripe errors with the upstream status code", async () => {
  reset();
  createShouldThrow = Object.assign(new Error("rate limited"), { status: 429 });
  const res = fakeRes();
  await handler(fakeReq({ headers: { authorization: "Bearer t1", host: "tinker.example" } }), res);
  assert.equal(res.captured.status, 429);
  assert.equal(res.captured.body.error, "rate limited");
});

test("502s when Stripe returns a session without a hosted URL", async () => {
  reset();
  createReturn = { id: "cs_test_abc" };
  const res = fakeRes();
  await handler(fakeReq({ headers: { authorization: "Bearer t1", host: "tinker.example" } }), res);
  assert.equal(res.captured.status, 502);
});
