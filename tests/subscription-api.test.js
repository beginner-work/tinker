/* api/subscription.js + api/me.js — the authenticated reads tinker uses
 * to reconcile the founder's plan tier against Stripe's source of truth.
 *
 * Stytch and Prisma are stubbed at the require cache (same pattern as
 * user-data.test.js) so the handlers run in-process with no network or
 * database.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const path = require("node:path");
const Module = require("node:module");

let stytchUserId = "user-test-abc";
let stytchShouldThrow = null;
const fakeStore = new Map(); // `${userId}::${kind}` -> { data, updatedAt }

const stytchStub = {
  authenticateSession: async () => {
    if (stytchShouldThrow) throw stytchShouldThrow;
    return { session: { user_id: stytchUserId }, user: { user_id: stytchUserId } };
  },
};
const dbStub = {
  tinkerUserData: {
    findUnique: async ({ where: { userId_kind: { userId, kind } } }) => {
      const key = `${userId}::${kind}`;
      return fakeStore.has(key) ? fakeStore.get(key) : null;
    },
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

const subscription = require("../api/subscription.js");
const me = require("../api/me.js");

function fakeReq({ method = "GET", headers = { authorization: "Bearer t" } } = {}) {
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
  stytchUserId = "user-test-abc";
  stytchShouldThrow = null;
  fakeStore.clear();
}

// ── /api/subscription ─────────────────────────────────────────────────

test("subscription: no row reads as the free tier", async () => {
  reset();
  const res = fakeRes();
  await subscription(fakeReq(), res);
  assert.equal(res.captured.status, 200);
  assert.deepEqual(
    { tier: res.captured.body.tier, active: res.captured.body.active },
    { tier: "free", active: false },
  );
});

test("subscription: a synced pre-seed row reads as unlocked", async () => {
  reset();
  fakeStore.set("user-test-abc::subscription", {
    data: { tier: "pre-seed", status: "active", source: "stripe" },
    updatedAt: new Date("2026-06-01T00:00:00Z"),
  });
  const res = fakeRes();
  await subscription(fakeReq(), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.tier, "pre-seed");
  assert.equal(res.captured.body.active, true);
});

test("subscription: a cancelled (free) row reads as locked", async () => {
  reset();
  fakeStore.set("user-test-abc::subscription", {
    data: { tier: "free", status: "canceled", source: "stripe" },
    updatedAt: new Date(),
  });
  const res = fakeRes();
  await subscription(fakeReq(), res);
  assert.equal(res.captured.body.tier, "free");
  assert.equal(res.captured.body.active, false);
});

test("subscription: unauthenticated -> 401", async () => {
  reset();
  stytchShouldThrow = Object.assign(new Error("bad session"), { status: 401 });
  const res = fakeRes();
  await subscription(fakeReq(), res);
  assert.equal(res.captured.status, 401);
});

test("subscription: non-GET -> 405", async () => {
  reset();
  const res = fakeRes();
  await subscription(fakeReq({ method: "POST" }), res);
  assert.equal(res.captured.status, 405);
});

// ── /api/me ───────────────────────────────────────────────────────────

test("me: returns the resolved userId", async () => {
  reset();
  stytchUserId = "user-live-xyz";
  const res = fakeRes();
  await me(fakeReq(), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.userId, "user-live-xyz");
});

test("me: unauthenticated -> 401", async () => {
  reset();
  stytchShouldThrow = Object.assign(new Error("no token"), { status: 401 });
  const res = fakeRes();
  await me(fakeReq(), res);
  assert.equal(res.captured.status, 401);
});
