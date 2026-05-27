/* Smoke tests for api/stripe-webhook.js — the Stripe webhook handler
 * that flips a founder's pre-seed entitlement to active. We stub
 * Prisma so the test stays in-process and verify the HMAC signature
 * scheme matches Stripe's `stripe.webhooks.constructEvent` contract.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const path = require("node:path");
const Module = require("node:module");

const prismaCalls = [];
const fakeStore = new Map();

const dbStub = {
  tinkerUserData: {
    findUnique: async ({ where: { userId_kind: { userId, kind } } }) => {
      prismaCalls.push(["find", userId, kind]);
      const key = `${userId}::${kind}`;
      return fakeStore.has(key) ? fakeStore.get(key) : null;
    },
    upsert: async ({ where: { userId_kind: { userId, kind } }, create, update }) => {
      prismaCalls.push(["upsert", userId, kind, update.data]);
      const row = { userId, kind, data: update.data ?? create.data, updatedAt: new Date() };
      fakeStore.set(`${userId}::${kind}`, row);
      return row;
    },
    update: async ({ where: { userId_kind: { userId, kind } }, data }) => {
      prismaCalls.push(["update", userId, kind, data.data]);
      const row = { userId, kind, data: data.data, updatedAt: new Date() };
      fakeStore.set(`${userId}::${kind}`, row);
      return row;
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
stubAt(path.join(libDir, "db.js"), dbStub);

const handler = require("../api/stripe-webhook.js");

const SECRET = "whsec_test_secret";

function fakeReq({ body, headers = {}, method = "POST" } = {}) {
  const buf = Buffer.from(body || "", "utf8");
  const stream = Readable.from([buf]);
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

function signedHeader(rawBody, secret, atSeconds) {
  const t = atSeconds || Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex");
  return `t=${t},v1=${sig}`;
}

function withSecret(value, fn) {
  const prev = process.env.STRIPE_WEBHOOK_SECRET;
  if (value === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = value;
  return Promise.resolve().then(fn).finally(() => {
    if (prev === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prev;
  });
}

function reset() {
  prismaCalls.length = 0;
  fakeStore.clear();
}

test("returns 503 when STRIPE_WEBHOOK_SECRET is unset", async () => {
  await withSecret(undefined, async () => {
    reset();
    const res = fakeRes();
    await handler(fakeReq({ body: "{}", headers: {} }), res);
    assert.equal(res.captured.status, 503);
  });
});

test("rejects with 400 when the Stripe signature is missing", async () => {
  await withSecret(SECRET, async () => {
    reset();
    const res = fakeRes();
    await handler(fakeReq({ body: "{}", headers: {} }), res);
    assert.equal(res.captured.status, 400);
  });
});

test("rejects with 400 when the HMAC doesn't match", async () => {
  await withSecret(SECRET, async () => {
    reset();
    const body = JSON.stringify({ type: "checkout.session.completed" });
    const tampered = signedHeader(body, "wrong-secret");
    const res = fakeRes();
    await handler(fakeReq({ body, headers: { "stripe-signature": tampered } }), res);
    assert.equal(res.captured.status, 400);
  });
});

test("rejects with 400 when the timestamp is outside the 5-minute tolerance", async () => {
  await withSecret(SECRET, async () => {
    reset();
    const body = "{}";
    const old = Math.floor(Date.now() / 1000) - 60 * 10;
    const header = signedHeader(body, SECRET, old);
    const res = fakeRes();
    await handler(fakeReq({ body, headers: { "stripe-signature": header } }), res);
    assert.equal(res.captured.status, 400);
  });
});

test("checkout.session.completed activates pre-seed for the client_reference_id user", async () => {
  await withSecret(SECRET, async () => {
    reset();
    const body = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_123", client_reference_id: "user-stytch-abc" } },
    });
    const header = signedHeader(body, SECRET);
    const res = fakeRes();
    await handler(fakeReq({ body, headers: { "stripe-signature": header } }), res);
    assert.equal(res.captured.status, 200);
    assert.deepEqual(res.captured.body, { received: true });
    const row = fakeStore.get("user-stytch-abc::subscription");
    assert.ok(row, "row should be upserted");
    assert.equal(row.data.tier, "preseed");
    assert.equal(row.data.status, "active");
    assert.equal(row.data.source, "stripe-webhook");
    assert.equal(row.data.stripeRef, "cs_test_123");
  });
});

test("checkout.session.completed without client_reference_id is a 200 no-op", async () => {
  await withSecret(SECRET, async () => {
    reset();
    const body = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_999" } },
    });
    const header = signedHeader(body, SECRET);
    const res = fakeRes();
    await handler(fakeReq({ body, headers: { "stripe-signature": header } }), res);
    assert.equal(res.captured.status, 200);
    assert.equal(prismaCalls.length, 0);
  });
});

test("ignores event types other than checkout.session.completed and customer.subscription.deleted", async () => {
  await withSecret(SECRET, async () => {
    reset();
    const body = JSON.stringify({ type: "ping" });
    const header = signedHeader(body, SECRET);
    const res = fakeRes();
    await handler(fakeReq({ body, headers: { "stripe-signature": header } }), res);
    assert.equal(res.captured.status, 200);
    assert.equal(prismaCalls.length, 0);
  });
});

test("customer.subscription.deleted flips an existing row to inactive", async () => {
  await withSecret(SECRET, async () => {
    reset();
    fakeStore.set("user-stytch-abc::subscription", {
      userId: "user-stytch-abc",
      kind: "subscription",
      data: { tier: "preseed", status: "active", activatedAt: 123 },
      updatedAt: new Date(),
    });
    const body = JSON.stringify({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_test_1", metadata: { client_reference_id: "user-stytch-abc" } } },
    });
    const header = signedHeader(body, SECRET);
    const res = fakeRes();
    await handler(fakeReq({ body, headers: { "stripe-signature": header } }), res);
    assert.equal(res.captured.status, 200);
    const row = fakeStore.get("user-stytch-abc::subscription");
    assert.equal(row.data.status, "inactive");
    assert.equal(row.data.activatedAt, 123);
    assert.ok(row.data.deactivatedAt > 0);
  });
});

test("rejects non-POST methods with 405", async () => {
  await withSecret(SECRET, async () => {
    reset();
    const res = fakeRes();
    res.setHeader = () => {};
    await handler({ method: "GET", headers: {}, on() {} }, res);
    assert.equal(res.captured.status, 405);
  });
});
