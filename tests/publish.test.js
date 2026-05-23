/* Smoke tests for api/publish/pitch.js and api/_lib/deck-template.js.
 * Stytch + Prisma are stubbed at the require cache so the handler stays
 * in-process. pitch-deck.md on disk supplies the real Marp frontmatter
 * — that's the styling guarantee the publish flow promises ("refresh
 *  the body, keep the styling").
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const path = require("node:path");
const Module = require("node:module");

const stytchCalls = [];
const prismaCalls = [];
let stytchUserId = "user-test-abc";
const fakeStore = new Map();

const stytchStub = {
  authenticateSession: async (token) => {
    stytchCalls.push(token);
    return { session: { user_id: stytchUserId }, user: { user_id: stytchUserId } };
  },
};
const dbStub = {
  tinkerUserData: {
    upsert: async ({ where: { userId_kind: { userId, kind } }, create, update }) => {
      prismaCalls.push(["upsert", userId, kind, update.data]);
      const updatedAt = new Date("2026-05-23T12:00:00Z");
      const row = { userId, kind, data: update.data ?? create.data, updatedAt };
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
stubAt(path.join(libDir, "stytch.js"), stytchStub);
stubAt(path.join(libDir, "db.js"), dbStub);

const publish = require("../api/publish/pitch.js");
const deckTemplate = require("../api/_lib/deck-template.js");

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
  stytchCalls.length = 0;
  prismaCalls.length = 0;
  stytchUserId = "user-test-abc";
  fakeStore.clear();
}

// ── deck-template ─────────────────────────────────────────────────────

test("renderDeck preserves the canonical Marp frontmatter", () => {
  const { markdown } = deckTemplate.renderDeck({
    title: "Tinker",
    slides: { "The Problem": ["A founder feels stuck."] },
    generatedAt: Date.UTC(2026, 4, 23),
  });
  // Frontmatter starts at line 1, ends on the first stand-alone `---`.
  assert.ok(markdown.startsWith("---\nmarp: true"), "should open with marp: true frontmatter");
  assert.match(markdown, /backgroundColor: "#fffdf7"/, "should carry pitch-deck.md's background");
  assert.match(markdown, /style: \|/, "should keep the inline style block");
});

test("renderDeck renders body slides as plain paragraphs, not pull-quotes", () => {
  const { markdown, beatCount } = deckTemplate.renderDeck({
    title: "Coffee",
    slides: {
      "The Problem": ["No good coffee on the way to work."],
      "A Persona": ["A 32-year-old who walks to the train each morning."],
    },
    generatedAt: Date.UTC(2026, 4, 23),
  });
  assert.equal(beatCount, 2);
  assert.match(markdown, /# The Problem\n\nNo good coffee/, "post-format: paragraph under heading");
  assert.doesNotMatch(markdown, /> \*No good coffee/, "post-format: no pull-quote blockquote");
});

test("renderDeck cover slide uses post dateline, not fundraising lockup", () => {
  const { markdown } = deckTemplate.renderDeck({
    title: "Tinker",
    slides: { "The Problem": ["x"] },
    generatedAt: Date.UTC(2026, 4, 23),
  });
  assert.match(markdown, /# Tinker\n\n<p class="tagline">a daily beginner<\/p>/);
  assert.match(markdown, /2026-05-23/);
  assert.doesNotMatch(markdown, /Pre-seed/);
});

test("renderDeck skips beats with no phrases", () => {
  const { markdown, beatCount } = deckTemplate.renderDeck({
    title: "Tinker",
    slides: { "The Problem": ["only beat present"] },
    generatedAt: Date.UTC(2026, 4, 23),
  });
  assert.equal(beatCount, 1);
  // The other ten beats should not appear in the body.
  assert.doesNotMatch(markdown, /# A Persona/);
  assert.doesNotMatch(markdown, /# The Ask/);
});

test("renderDeck rejects missing title and missing slides", () => {
  assert.throws(() => deckTemplate.renderDeck({ slides: {} }), /title is required/);
  assert.throws(() => deckTemplate.renderDeck({ title: "T" }), /slides must be an object/);
});

// ── /api/publish/pitch ────────────────────────────────────────────────

test("POST rejects non-POST methods", async () => {
  reset();
  const res = fakeRes();
  await publish._raw(fakeReq({ method: "GET", headers: { authorization: "Bearer t" } }), res);
  assert.equal(res.captured.status, 405);
  assert.equal(res.captured.headers.Allow, "POST");
});

test("POST requires a session token", async () => {
  reset();
  const res = fakeRes();
  const body = JSON.stringify({ title: "Tinker", slides: { "The Problem": ["x"] } });
  // Empty bearer → Stytch stub returns user_id anyway, but resolveUserId
  // path still flows; force a missing user by clearing the userId.
  stytchUserId = "";
  await publish._raw(
    fakeReq({ method: "POST", raw: body, headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.status, 401);
});

test("POST upserts a published row and returns the reader path", async () => {
  reset();
  const res = fakeRes();
  const body = JSON.stringify({
    title: "Tinker",
    slides: {
      "The Problem": ["a founder feels stuck", "  "],
      "A Persona": ["thirty-two, coffee on the way to work"],
      "Unknown Beat": ["should be ignored"],
    },
  });
  await publish._raw(
    fakeReq({ method: "POST", raw: body, headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.status, 200, JSON.stringify(res.captured.body));
  assert.equal(res.captured.body.ok, true);
  assert.equal(res.captured.body.slug, "tinker");
  assert.equal(res.captured.body.beatCount, 2);
  assert.equal(
    res.captured.body.readerPath,
    "/daily/?u=user-test-abc&t=tinker",
  );
  assert.equal(prismaCalls.length, 1);
  assert.equal(prismaCalls[0][2], "published:tinker");
  const stored = prismaCalls[0][3];
  assert.ok(stored.markdown.startsWith("---\nmarp: true"));
  assert.match(stored.markdown, /# Tinker/);
  assert.match(stored.markdown, /# The Problem/);
  assert.match(stored.markdown, /# A Persona/);
  assert.doesNotMatch(stored.markdown, /Unknown Beat/);
});

test("POST 400s when no beat has a usable phrase", async () => {
  reset();
  const res = fakeRes();
  const body = JSON.stringify({ title: "Tinker", slides: { "The Problem": ["", "   "] } });
  await publish._raw(
    fakeReq({ method: "POST", raw: body, headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.status, 400);
  assert.match(res.captured.body.error, /at least one beat/);
});

test("slugify lowercases and replaces non-alphanumerics with hyphens", () => {
  assert.equal(publish._slugify("Tinker"), "tinker");
  assert.equal(publish._slugify("Daily Beginner"), "daily-beginner");
  assert.equal(publish._slugify("café--shop!"), "caf-shop");
  assert.equal(publish._slugify("   "), "");
});
