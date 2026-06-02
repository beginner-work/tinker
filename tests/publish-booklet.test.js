/* Smoke tests for api/publish/booklet.js. Stytch + Prisma are stubbed at
 * the require cache so the handler stays in-process. No network, no DB.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const path = require("node:path");
const Module = require("node:module");

const prismaCalls = [];
let stytchUserId = "user-test-abc";

const stytchStub = {
  authenticateSession: async () => {
    return { session: { user_id: stytchUserId }, user: { user_id: stytchUserId } };
  },
};
const dbStub = {
  tinkerUserData: {
    upsert: async ({ where: { userId_kind: { userId, kind } }, create, update }) => {
      prismaCalls.push(["upsert", userId, kind, update.data]);
      return {
        userId,
        kind,
        data: update.data ?? create.data,
        updatedAt: new Date("2026-05-23T12:00:00Z"),
      };
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

const publish = require("../api/publish/booklet.js");

function fakeReq({ method = "POST", raw, headers = {} } = {}) {
  const stream = Readable.from(raw == null ? [] : [Buffer.from(raw)]);
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
  prismaCalls.length = 0;
  stytchUserId = "user-test-abc";
}

// ── validateBody ──────────────────────────────────────────────────────

test("validateBody keeps pitches that have a story and drops empty ones", () => {
  const { pitches, storyCount } = publish._validateBody({
    pitches: [
      { title: "Coffee", stories: [{ title: "Morning", body: "I walk to the train." }] },
      { title: "Empty", stories: [{ body: "   " }] },
      { title: "NoStories", stories: [] },
    ],
  });
  assert.equal(pitches.length, 1);
  assert.equal(pitches[0].title, "Coffee");
  assert.equal(pitches[0].slug, "coffee");
  assert.equal(pitches[0].stories.length, 1);
  assert.equal(storyCount, 1);
});

test("validateBody disambiguates duplicate slugs", () => {
  const { pitches } = publish._validateBody({
    pitches: [
      { title: "Home", stories: [{ body: "a" }] },
      { title: "Home", stories: [{ body: "b" }] },
    ],
  });
  assert.equal(pitches.length, 2);
  assert.equal(pitches[0].slug, "home");
  assert.equal(pitches[1].slug, "home-2");
});

test("validateBody defaults a blank pitch title to Untitled", () => {
  const { pitches } = publish._validateBody({
    pitches: [{ title: "   ", stories: [{ body: "x" }] }],
  });
  assert.equal(pitches[0].title, "Untitled");
  assert.equal(pitches[0].slug, "untitled");
});

test("validateBody throws when pitches is missing", () => {
  assert.throws(() => publish._validateBody({}), /pitches is required/);
});

test("validateBody throws when no pitch has a story", () => {
  assert.throws(
    () => publish._validateBody({ pitches: [{ title: "A", stories: [] }] }),
    /at least one pitch must have a story/,
  );
});

// ── /api/publish/booklet ──────────────────────────────────────────────

test("POST rejects non-POST methods", async () => {
  reset();
  const res = fakeRes();
  await publish._raw(fakeReq({ method: "GET", headers: { authorization: "Bearer t" } }), res);
  assert.equal(res.captured.status, 405);
  assert.equal(res.captured.headers.Allow, "POST");
});

test("POST requires a session user id", async () => {
  reset();
  stytchUserId = "";
  const res = fakeRes();
  const body = JSON.stringify({ pitches: [{ title: "A", stories: [{ body: "x" }] }] });
  await publish._raw(
    fakeReq({ method: "POST", raw: body, headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.status, 401);
});

test("POST upserts the booklets row and returns the profile link", async () => {
  reset();
  const res = fakeRes();
  const body = JSON.stringify({
    pitches: [
      { title: "Coffee", stories: [{ title: "Morning", body: "I walk to the train." }] },
      { title: "Skip", stories: [{ body: "" }] },
    ],
  });
  await publish._raw(
    fakeReq({ method: "POST", raw: body, headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.status, 200, JSON.stringify(res.captured.body));
  assert.equal(res.captured.body.ok, true);
  assert.equal(res.captured.body.count, 1);
  assert.equal(res.captured.body.storyCount, 1);
  assert.equal(
    res.captured.body.storiesUrl,
    "https://beginner.work/tyler-lindow?u=user-test-abc#stories",
  );
  assert.equal(prismaCalls.length, 1);
  assert.equal(prismaCalls[0][2], "booklets");
  const stored = prismaCalls[0][3];
  assert.equal(stored.pitches.length, 1);
  assert.equal(stored.pitches[0].stories[0].body, "I walk to the train.");
});

test("POST 400s when the body has no publishable pitch", async () => {
  reset();
  const res = fakeRes();
  const body = JSON.stringify({ pitches: [{ title: "A", stories: [{ body: "  " }] }] });
  await publish._raw(
    fakeReq({ method: "POST", raw: body, headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.status, 400);
  assert.match(res.captured.body.error, /at least one pitch/);
});

// ── helpers ───────────────────────────────────────────────────────────

test("slugify lowercases and hyphenates", () => {
  assert.equal(publish._slugify("Coffee"), "coffee");
  assert.equal(publish._slugify("Daily Beginner"), "daily-beginner");
  assert.equal(publish._slugify("   "), "");
});

test("isSlug accepts slug shape and rejects garbage", () => {
  assert.equal(publish._isSlug("coffee"), true);
  assert.equal(publish._isSlug("daily-beginner"), true);
  assert.equal(publish._isSlug("Coffee"), false);
  assert.equal(publish._isSlug("../etc"), false);
});

test("readerHost is always production beginner.work, even on previews", () => {
  const prev = { ...process.env };
  try {
    delete process.env.VERCEL_ENV;
    assert.equal(publish._readerHost(), "https://beginner.work");
    process.env.VERCEL_ENV = "preview";
    assert.equal(publish._readerHost(), "https://beginner.work");
  } finally {
    process.env = prev;
  }
});
