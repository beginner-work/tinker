/* Tests for the founder-coin staking ledger — api/_lib/stakes.js and the
 * four /api/stakes/* endpoints. Stytch and Prisma are stubbed via the
 * module cache (same pattern as user-data.test.js) so everything stays
 * in-process; the Prisma stub adds $transaction/findFirst on top of the
 * user-data one because the ledger moves two rows atomically.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const path = require("node:path");
const Module = require("node:module");

// ── Stubs (installed before requiring the code under test) ────────────
let stytchUserId = "user-backer-1";
let stytchShouldThrow = null;
const fakeStore = new Map(); // `${userId}::${kind}` → { userId, kind, data, updatedAt }

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
    findFirst: async ({ where: { userId } }) => {
      for (const row of fakeStore.values()) {
        if (row.userId === userId) return { userId };
      }
      return null;
    },
    upsert: async ({ where: { userId_kind: { userId, kind } }, create, update }) => {
      const key = `${userId}::${kind}`;
      const data = fakeStore.has(key) ? update.data : create.data;
      // Deep-copy so later in-memory mutation can't retroactively edit
      // the "database" — same round-trip a real JSON column gives us.
      const row = {
        userId, kind,
        data: JSON.parse(JSON.stringify(data)),
        updatedAt: new Date("2026-07-08T12:00:00Z"),
      };
      fakeStore.set(key, row);
      return row;
    },
  },
  $transaction: async (fn) => fn(dbStub),
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

const { SEED_CENTS, deriveSymbol } = require("../api/_lib/stakes.js");
const walletHandler = require("../api/stakes/wallet.js");
const coinHandler = require("../api/stakes/coin.js");
const placeHandler = require("../api/stakes/place.js");
const releaseHandler = require("../api/stakes/release.js");

// ── Helpers ────────────────────────────────────────────────────────────
function fakeReq({ method = "GET", body, url = "/api/stakes/x", headers } = {}) {
  const stream = Readable.from([]);
  Object.assign(stream, {
    method,
    url,
    body,
    headers: Object.assign({ authorization: "Bearer t1" }, headers || {}),
  });
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
  stytchUserId = "user-backer-1";
  stytchShouldThrow = null;
  fakeStore.clear();
  // The founder being staked on must exist as a tinker user; a profile
  // row (with a name, so the coin gets a real symbol) proves it.
  fakeStore.set("user-founder-1::profile", {
    userId: "user-founder-1",
    kind: "profile",
    data: { name: "Tyler Lindow" },
    updatedAt: new Date(),
  });
}
async function call(handler, opts) {
  const res = fakeRes();
  await handler(fakeReq(opts), res);
  return res.captured;
}
async function placeOk(founderId, amountCents) {
  const out = await call(placeHandler, {
    method: "POST",
    body: { founderId, amountCents },
  });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  return out.body;
}

// ── Tests ──────────────────────────────────────────────────────────────

test("wallet seeds the practice balance on first touch", async () => {
  reset();
  const out = await call(walletHandler, { method: "GET" });
  assert.equal(out.status, 200);
  assert.equal(out.body.balanceCents, SEED_CENTS);
  assert.equal(out.body.currency, "USDC");
  assert.deepEqual(out.body.stakes, []);
  assert.ok(out.body.seededAt);
  // Second read returns the stored row, not a fresh seed.
  const again = await call(walletHandler, { method: "GET" });
  assert.equal(again.body.seededAt, out.body.seededAt);
});

test("placing a stake moves balance onto the founder's coin", async () => {
  reset();
  const body = await placeOk("user-founder-1", 2500);
  assert.equal(body.ok, true);
  assert.equal(body.wallet.balanceCents, SEED_CENTS - 2500);
  assert.equal(body.wallet.stakes.length, 1);
  assert.equal(body.stake.founderId, "user-founder-1");
  assert.equal(body.coin.symbol, "TYLE"); // from the profile name
  assert.equal(body.coin.totalStakedCents, 2500);
  assert.equal(body.coin.backerCount, 1);
  assert.equal(body.coin.myStakeCents, 2500);
});

test("two stakes from one backer accumulate on the coin", async () => {
  reset();
  await placeOk("user-founder-1", 1000);
  const body = await placeOk("user-founder-1", 500);
  assert.equal(body.coin.totalStakedCents, 1500);
  assert.equal(body.coin.backerCount, 1);
  assert.equal(body.wallet.balanceCents, SEED_CENTS - 1500);
  assert.equal(body.wallet.stakes.length, 2);
});

test("coins aggregate across distinct backers", async () => {
  reset();
  await placeOk("user-founder-1", 1000);
  stytchUserId = "user-backer-2";
  const body = await placeOk("user-founder-1", 2000);
  assert.equal(body.coin.totalStakedCents, 3000);
  assert.equal(body.coin.backerCount, 2);
  assert.equal(body.coin.myStakeCents, 2000);
});

test("staking more than the balance is rejected", async () => {
  reset();
  const out = await call(placeHandler, {
    method: "POST",
    body: { founderId: "user-founder-1", amountCents: SEED_CENTS + 1 },
  });
  assert.equal(out.status, 400);
});

test("self-staking is rejected", async () => {
  reset();
  fakeStore.set("user-backer-1::profile", {
    userId: "user-backer-1", kind: "profile", data: { name: "Me" }, updatedAt: new Date(),
  });
  const out = await call(placeHandler, {
    method: "POST",
    body: { founderId: "user-backer-1", amountCents: 100 },
  });
  assert.equal(out.status, 400);
});

test("staking on an unknown founder is a 404", async () => {
  reset();
  const out = await call(placeHandler, {
    method: "POST",
    body: { founderId: "user-nobody", amountCents: 100 },
  });
  assert.equal(out.status, 404);
});

test("amount must be a positive integer of cents", async () => {
  reset();
  for (const amountCents of [0, -5, 12.5, "100", null]) {
    const out = await call(placeHandler, {
      method: "POST",
      body: { founderId: "user-founder-1", amountCents },
    });
    assert.equal(out.status, 400, `amountCents=${amountCents}`);
  }
});

test("releasing a stake returns the funds and shrinks the coin", async () => {
  reset();
  const placed = await placeOk("user-founder-1", 2500);
  const out = await call(releaseHandler, {
    method: "POST",
    body: { stakeId: placed.stake.id },
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.wallet.balanceCents, SEED_CENTS);
  assert.deepEqual(out.body.wallet.stakes, []);
  assert.equal(out.body.released.amountCents, 2500);

  const coin = await call(coinHandler, {
    method: "GET",
    url: "/api/stakes/coin?founder=user-founder-1",
  });
  assert.equal(coin.body.totalStakedCents, 0);
  assert.equal(coin.body.backerCount, 0);
  assert.equal(coin.body.myStakeCents, 0);
});

test("releasing an unknown stake id is a 404", async () => {
  reset();
  await placeOk("user-founder-1", 100);
  const out = await call(releaseHandler, {
    method: "POST",
    body: { stakeId: "stk_nope" },
  });
  assert.equal(out.status, 404);
});

test("coin endpoint resolves founder=me to the caller", async () => {
  reset();
  const out = await call(coinHandler, {
    method: "GET",
    url: "/api/stakes/coin?founder=me",
  });
  assert.equal(out.status, 200);
  assert.equal(out.body.founderId, "user-backer-1");
  assert.equal(out.body.totalStakedCents, 0);
});

test("all endpoints require a valid session", async () => {
  reset();
  stytchShouldThrow = Object.assign(new Error("bad token"), { status: 401 });
  for (const [handler, method] of [
    [walletHandler, "GET"],
    [coinHandler, "GET"],
    [placeHandler, "POST"],
    [releaseHandler, "POST"],
  ]) {
    const out = await call(handler, { method, body: {} });
    assert.equal(out.status, 401);
  }
});

test("deriveSymbol prefers the name, falls back to the user id", () => {
  assert.equal(deriveSymbol("Tyler Lindow", "user-x"), "TYLE");
  assert.equal(deriveSymbol("Jo", "user-x"), "JO");
  assert.equal(deriveSymbol("", "user-test-9zq"), "FDR9ZQ");
});
