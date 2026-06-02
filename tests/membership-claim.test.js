/* Smoke tests for api/membership/claim.js — binds a one-time pre-seed pass
 * (userId="pending:<token>", kind="membership") to the signed-in Stytch
 * account. Stytch, Prisma, and the response-logging wrapper are stubbed so the
 * test stays in-process (no network, no database). Mirrors profile-claim.test.js.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const path = require("node:path");
const Module = require("node:module");

// ── Stubs (installed before requiring claim.js) ────────────────────────
let stytchUserId = "user-abc";
let stytchShouldThrow = null;
const fakeStore = new Map(); // key: `${userId}::${kind}` → { userId, kind, data }
const key = (userId, kind) => `${userId}::${kind}`;

const stytchStub = {
  authenticateSession: async (token) => {
    if (stytchShouldThrow) throw stytchShouldThrow;
    if (!token) throw Object.assign(new Error("No session token"), { status: 401 });
    return { session: { user_id: stytchUserId }, user: { user_id: stytchUserId } };
  },
};
const dbStub = {
  tinkerUserData: {
    findUnique: async ({ where: { userId_kind: { userId, kind } } }) => {
      const k = key(userId, kind);
      return fakeStore.has(k) ? fakeStore.get(k) : null;
    },
    upsert: async ({ where: { userId_kind: { userId, kind } }, create, update }) => {
      const row = { userId, kind, data: update.data ?? create.data };
      fakeStore.set(key(userId, kind), row);
      return row;
    },
    delete: async ({ where: { userId_kind: { userId, kind } } }) => {
      const k = key(userId, kind);
      if (!fakeStore.has(k)) throw Object.assign(new Error("not found"), { code: "P2025" });
      const row = fakeStore.get(k);
      fakeStore.delete(k);
      return row;
    },
  },
};
const logStub = { withResponseLogging: (h) => h, isPreview: () => false };

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
stubAt(path.join(libDir, "log.js"), logStub);
// membership.js is pure (only requires db.js, already stubbed) — load it for real.

const handler = require("../api/membership/claim.js");
const { mergePass } = handler;

// ── Helpers ────────────────────────────────────────────────────────────
function fakeReq({ method = "POST", raw, body, headers = {} } = {}) {
  const stream = Readable.from(raw == null ? [] : [Buffer.from(raw)]);
  Object.assign(stream, { headers, method, body });
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
  stytchShouldThrow = null;
  stytchUserId = "user-abc";
  fakeStore.clear();
}
const auth = { authorization: "Bearer s1", "content-type": "application/json" };
const soon = () => Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // ~30 days out
function seedPass(token, over = {}) {
  const data = Object.assign({
    tier: "pre-seed",
    status: "active",
    oneTime: true,
    source: "preseed-once",
    currentPeriodEnd: soon(),
    createdAt: new Date().toISOString(),
  }, over);
  fakeStore.set(key("pending:" + token, "membership"), {
    userId: "pending:" + token, kind: "membership", data,
  });
  return data;
}

// ── mergePass (pure) ─────────────────────────────────────────────────────

test("mergePass: grants a pass to a free account", () => {
  const pass = { tier: "pre-seed", oneTime: true, currentPeriodEnd: soon() };
  assert.equal(mergePass(null, pass), pass);
  assert.equal(mergePass({ tier: "pre-seed", status: "canceled" }, pass), pass);
});

test("mergePass: an active subscription is never downgraded by a pass", () => {
  const pass = { tier: "pre-seed", oneTime: true, currentPeriodEnd: soon() };
  assert.equal(mergePass({ tier: "pre-seed", status: "active" }, pass), null);
  assert.equal(mergePass({ tier: "pre-seed", status: "past_due" }, pass), null);
});

test("mergePass: between passes the later expiry wins", () => {
  const later = soon();
  const earlier = later - 10 * 24 * 60 * 60;
  const incoming = { tier: "pre-seed", oneTime: true, currentPeriodEnd: later };
  // existing pass expires sooner → take the incoming (longer) one.
  assert.equal(mergePass({ tier: "pre-seed", oneTime: true, currentPeriodEnd: earlier }, incoming), incoming);
  // existing pass already reaches further → keep it.
  assert.equal(mergePass({ tier: "pre-seed", oneTime: true, currentPeriodEnd: later + 100 }, incoming), null);
});

// ── Endpoint ───────────────────────────────────────────────────────────

test("non-POST is 405", async () => {
  reset();
  const res = fakeRes();
  await handler(fakeReq({ method: "GET", headers: auth }), res);
  assert.equal(res.captured.status, 405);
  assert.equal(res.captured.headers.Allow, "POST");
});

test("missing session token is 401", async () => {
  reset();
  const res = fakeRes();
  await handler(fakeReq({ headers: { "content-type": "application/json" }, raw: '{"claim_token":"t"}' }), res);
  assert.equal(res.captured.status, 401);
});

test("missing claim_token is 400", async () => {
  reset();
  const res = fakeRes();
  await handler(fakeReq({ headers: auth, raw: "{}" }), res);
  assert.equal(res.captured.status, 400);
});

test("no pending pass → benign no-op (token kept for retry, nothing granted)", async () => {
  reset();
  const res = fakeRes();
  await handler(fakeReq({ headers: auth, raw: '{"claim_token":"nope"}' }), res);
  assert.equal(res.captured.status, 200);
  assert.deepEqual(res.captured.body, { ok: true, claimed: false });
  assert.equal(fakeStore.has(key("user-abc", "membership")), false);
});

test("pending pass + free account → granted, bound, pending consumed", async () => {
  reset();
  const pass = seedPass("tok1");
  const res = fakeRes();
  await handler(fakeReq({ headers: auth, raw: '{"claim_token":"tok1"}' }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.claimed, true);
  assert.deepEqual(fakeStore.get(key("user-abc", "membership")).data, pass);
  assert.equal(fakeStore.has(key("pending:tok1", "membership")), false);
});

test("an active subscription is not downgraded; pending still consumed", async () => {
  reset();
  const sub = { tier: "pre-seed", status: "active", stripeSubscriptionId: "sub_1" };
  fakeStore.set(key("user-abc", "membership"), { userId: "user-abc", kind: "membership", data: sub });
  seedPass("tok2");
  const res = fakeRes();
  await handler(fakeReq({ headers: auth, raw: '{"claim_token":"tok2"}' }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.claimed, false);
  assert.deepEqual(fakeStore.get(key("user-abc", "membership")).data, sub, "subscription untouched");
  assert.equal(fakeStore.has(key("pending:tok2", "membership")), false);
});

test("expired (stale) pending pass → no-op and pending deleted", async () => {
  reset();
  seedPass("tok3", { createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() });
  const res = fakeRes();
  await handler(fakeReq({ headers: auth, raw: '{"claim_token":"tok3"}' }), res);
  assert.equal(res.captured.status, 200);
  assert.deepEqual(res.captured.body, { ok: true, claimed: false });
  assert.equal(fakeStore.has(key("pending:tok3", "membership")), false);
  assert.equal(fakeStore.has(key("user-abc", "membership")), false);
});
