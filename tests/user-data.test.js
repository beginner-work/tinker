/* Smoke tests for api/_lib/user-data.js — the shared GET/PUT factory
 * for the /api/user-data/<kind> endpoints. We stub Stytch and Prisma
 * so the test stays in-process and doesn't touch the network or the
 * database.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const path = require("node:path");
const Module = require("node:module");

// ── Stubs (installed before requiring user-data.js) ────────────────────
const stytchCalls = [];
const prismaCalls = [];
let stytchUserId = "user-test-abc";
let stytchShouldThrow = null;
const fakeStore = new Map(); // key: `${userId}::${kind}` → { data, updatedAt }

const stytchStub = {
  authenticateSession: async (token) => {
    stytchCalls.push(token);
    if (stytchShouldThrow) throw stytchShouldThrow;
    return { session: { user_id: stytchUserId }, user: { user_id: stytchUserId } };
  },
};
const dbStub = {
  tinkerUserData: {
    findUnique: async ({ where: { userId_kind: { userId, kind } } }) => {
      prismaCalls.push(["find", userId, kind]);
      const key = `${userId}::${kind}`;
      return fakeStore.has(key) ? fakeStore.get(key) : null;
    },
    upsert: async ({ where: { userId_kind: { userId, kind } }, create, update }) => {
      prismaCalls.push(["upsert", userId, kind, update.data]);
      const updatedAt = new Date("2026-05-15T12:00:00Z");
      const row = { userId, kind, data: update.data ?? create.data, updatedAt };
      fakeStore.set(`${userId}::${kind}`, row);
      return row;
    },
  },
};

// Pre-seed Node's module cache with our stubs at the same absolute paths
// that user-data.js resolves to. Loading user-data.js below then picks
// up our cached objects instead of the real modules.
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

const { makeHandler } = require("../api/_lib/user-data.js");

// ── Helpers ────────────────────────────────────────────────────────────
function fakeReq({ method = "GET", body, raw, headers = {} } = {}) {
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
  stytchCalls.length = 0;
  prismaCalls.length = 0;
  stytchShouldThrow = null;
  stytchUserId = "user-test-abc";
  fakeStore.clear();
}

// ── Tests ──────────────────────────────────────────────────────────────

test("GET returns null data when no row exists", async () => {
  reset();
  const handler = makeHandler("essays");
  const res = fakeRes();
  await handler(
    fakeReq({ method: "GET", headers: { authorization: "Bearer t1" } }),
    res,
  );
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.data, null);
  assert.deepEqual(stytchCalls, ["t1"]);
});

test("PUT upserts, GET reads back the same data", async () => {
  reset();
  const handler = makeHandler("essays");

  const put = fakeRes();
  await handler(
    fakeReq({
      method: "PUT",
      headers: { authorization: "Bearer t1" },
      body: { data: [{ id: "e_1", title: "hi" }] },
    }),
    put,
  );
  assert.equal(put.captured.status, 200);
  assert.equal(put.captured.body.ok, true);

  const get = fakeRes();
  await handler(
    fakeReq({ method: "GET", headers: { authorization: "Bearer t1" } }),
    get,
  );
  assert.equal(get.captured.status, 200);
  assert.deepEqual(get.captured.body.data, [{ id: "e_1", title: "hi" }]);
});

test("PUT requires a `data` field in the body", async () => {
  reset();
  const handler = makeHandler("drafts");
  const res = fakeRes();
  await handler(
    fakeReq({
      method: "PUT",
      headers: { authorization: "Bearer t1" },
      body: { wrongField: true },
    }),
    res,
  );
  assert.equal(res.captured.status, 400);
  assert.match(res.captured.body.error, /data/);
});

test("rejects non-GET, non-PUT methods with 405", async () => {
  reset();
  const handler = makeHandler("earths");
  const res = fakeRes();
  await handler(
    fakeReq({ method: "DELETE", headers: { authorization: "Bearer t1" } }),
    res,
  );
  assert.equal(res.captured.status, 405);
  assert.equal(res.captured.headers["Allow"], "GET, PUT");
});

test("returns 401 when Stytch rejects the token", async () => {
  reset();
  stytchShouldThrow = Object.assign(new Error("Session expired."), { status: 401 });
  const handler = makeHandler("taxonomy");
  const res = fakeRes();
  await handler(
    fakeReq({ method: "GET", headers: { authorization: "Bearer expired" } }),
    res,
  );
  assert.equal(res.captured.status, 401);
  assert.equal(res.captured.body.error, "Session expired.");
});

test("rows for different users do not collide", async () => {
  reset();
  const handler = makeHandler("earths");

  stytchUserId = "user-test-alice";
  await handler(
    fakeReq({
      method: "PUT",
      headers: { authorization: "Bearer alice" },
      body: { data: { explicit: [{ name: "kitchen" }], hidden: [] } },
    }),
    fakeRes(),
  );

  stytchUserId = "user-test-bob";
  await handler(
    fakeReq({
      method: "PUT",
      headers: { authorization: "Bearer bob" },
      body: { data: { explicit: [{ name: "porch" }], hidden: [] } },
    }),
    fakeRes(),
  );

  stytchUserId = "user-test-alice";
  const aliceGet = fakeRes();
  await handler(
    fakeReq({ method: "GET", headers: { authorization: "Bearer alice" } }),
    aliceGet,
  );
  assert.deepEqual(aliceGet.captured.body.data.explicit, [{ name: "kitchen" }]);
});

test("different kinds for the same user are independent", async () => {
  reset();
  const essays = makeHandler("essays");
  const drafts = makeHandler("drafts");

  await essays(
    fakeReq({
      method: "PUT",
      headers: { authorization: "Bearer t1" },
      body: { data: [{ id: "e1" }] },
    }),
    fakeRes(),
  );
  await drafts(
    fakeReq({
      method: "PUT",
      headers: { authorization: "Bearer t1" },
      body: { data: [{ id: "d1" }] },
    }),
    fakeRes(),
  );

  const essaysGet = fakeRes();
  await essays(
    fakeReq({ method: "GET", headers: { authorization: "Bearer t1" } }),
    essaysGet,
  );
  const draftsGet = fakeRes();
  await drafts(
    fakeReq({ method: "GET", headers: { authorization: "Bearer t1" } }),
    draftsGet,
  );
  assert.deepEqual(essaysGet.captured.body.data, [{ id: "e1" }]);
  assert.deepEqual(draftsGet.captured.body.data, [{ id: "d1" }]);
});
