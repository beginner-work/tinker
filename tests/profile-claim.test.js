/* Smoke tests for api/profile/claim.js — binds a stashed landing-form
 * profile (userId="pending:<token>") to the signed-in Stytch account.
 * Stytch, Prisma, and the response-logging wrapper are stubbed so the
 * test stays in-process (no network, no database).
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
const fakeStore = new Map(); // key: `${userId}::${kind}` → { userId, kind, data, updatedAt }
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
      const updatedAt = new Date("2026-05-15T12:00:00Z");
      const row = { userId, kind, data: update.data ?? create.data, updatedAt };
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

const handler = require("../api/profile/claim.js");

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
function seedPending(token, data) {
  fakeStore.set(key("pending:" + token, "profile"), {
    userId: "pending:" + token, kind: "profile", data, updatedAt: new Date(),
  });
}
const sampleProfile = (over = {}) => Object.assign({
  name: "Jane Founder",
  email: "jane@example.com",
  avatarUrl: "https://x.public.blob.vercel-storage.com/avatars/tok.jpg",
  plan: "free",
  createdAt: new Date().toISOString(),
}, over);

// ── Tests ──────────────────────────────────────────────────────────────

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

test("no pending row → benign no-op", async () => {
  reset();
  const res = fakeRes();
  await handler(fakeReq({ headers: auth, raw: '{"claim_token":"nope"}' }), res);
  assert.equal(res.captured.status, 200);
  assert.deepEqual(res.captured.body, { ok: true, claimed: false });
});

test("pending row + no existing profile → claimed, bound, pending deleted", async () => {
  reset();
  const profile = sampleProfile();
  seedPending("tok1", profile);
  const res = fakeRes();
  await handler(fakeReq({ headers: auth, raw: '{"claim_token":"tok1"}' }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.claimed, true);
  assert.deepEqual(res.captured.body.profile, profile);
  // bound to the user
  assert.deepEqual(fakeStore.get(key("user-abc", "profile")).data, profile);
  // pending consumed
  assert.equal(fakeStore.has(key("pending:tok1", "profile")), false);
});

test("existing profile is not overwritten; pending still consumed", async () => {
  reset();
  const existing = sampleProfile({ name: "Original", email: "orig@example.com" });
  fakeStore.set(key("user-abc", "profile"), { userId: "user-abc", kind: "profile", data: existing, updatedAt: new Date() });
  seedPending("tok2", sampleProfile({ name: "Newcomer" }));
  const res = fakeRes();
  await handler(fakeReq({ headers: auth, raw: '{"claim_token":"tok2"}' }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.claimed, false);
  assert.deepEqual(res.captured.body.profile, existing);
  // unchanged
  assert.equal(fakeStore.get(key("user-abc", "profile")).data.name, "Original");
  // pending consumed
  assert.equal(fakeStore.has(key("pending:tok2", "profile")), false);
});

test("expired pending row → no-op and pending deleted", async () => {
  reset();
  const old = sampleProfile({ createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() });
  seedPending("tok3", old);
  const res = fakeRes();
  await handler(fakeReq({ headers: auth, raw: '{"claim_token":"tok3"}' }), res);
  assert.equal(res.captured.status, 200);
  assert.deepEqual(res.captured.body, { ok: true, claimed: false });
  assert.equal(fakeStore.has(key("pending:tok3", "profile")), false);
  assert.equal(fakeStore.has(key("user-abc", "profile")), false);
});
