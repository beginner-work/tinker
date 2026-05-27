/* Smoke tests for api/checkout/preseed.js — mints a Stripe payment-link
 * URL with the calling founder's Stytch user_id as
 * client_reference_id. We stub Stytch so the test stays in-process.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

let stytchUserId = "user-stytch-xyz";
let stytchShouldThrow = null;

const stytchStub = {
  authenticateSession: async () => {
    if (stytchShouldThrow) throw stytchShouldThrow;
    return { session: { user_id: stytchUserId } };
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

test("POST returns a Stripe URL with client_reference_id set to the Stytch user id", async () => {
  stytchUserId = "user-stytch-xyz";
  stytchShouldThrow = null;
  const res = fakeRes();
  await handler(fakeReq({ headers: { authorization: "Bearer t1" } }), res);
  assert.equal(res.captured.status, 200);
  assert.match(res.captured.body.url, /^https:\/\/buy\.stripe\.com\//);
  assert.match(res.captured.body.url, /client_reference_id=user-stytch-xyz/);
});

test("URL-encodes the user id when it contains characters Stripe expects encoded", async () => {
  stytchUserId = "user with space";
  stytchShouldThrow = null;
  const res = fakeRes();
  await handler(fakeReq({ headers: { authorization: "Bearer t1" } }), res);
  assert.match(res.captured.body.url, /client_reference_id=user%20with%20space/);
});

test("rejects non-POST methods with 405", async () => {
  stytchUserId = "user-stytch-xyz";
  const res = fakeRes();
  await handler(fakeReq({ method: "GET" }), res);
  assert.equal(res.captured.status, 405);
});

test("returns 401 when the bearer token is rejected by Stytch", async () => {
  stytchShouldThrow = Object.assign(new Error("Session expired."), { status: 401 });
  const res = fakeRes();
  await handler(fakeReq({ headers: { authorization: "Bearer bad" } }), res);
  assert.equal(res.captured.status, 401);
});
