/* Smoke tests for api/feed/discoverable.js and api/feed/adjacent.js.
 *
 * Stytch + Prisma are stubbed at the require cache so handlers stay
 * in-process. The adjacency endpoint's Claude call is stubbed via a
 * global fetch override; tests focus on validation, candidate
 * filtering, cold-start, and verbatim-grounding of the summary.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const path = require("node:path");
const Module = require("node:module");

const stytchCalls = [];
let stytchUserId = "user-self";
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
      const row = { userId, kind, data: update.data ?? create.data, updatedAt: new Date() };
      fakeStore.set(`${userId}::${kind}`, row);
      return row;
    },
    findUnique: async ({ where: { userId_kind: { userId, kind } } }) => {
      return fakeStore.get(`${userId}::${kind}`) || null;
    },
    findMany: async ({ where, orderBy }) => {
      let rows = Array.from(fakeStore.values());
      if (where) {
        if (typeof where.kind === "string") {
          rows = rows.filter((r) => r.kind === where.kind);
        } else if (where.kind && typeof where.kind.startsWith === "string") {
          rows = rows.filter((r) => r.kind.startsWith(where.kind.startsWith));
        }
        if (where.userId && Array.isArray(where.userId.in)) {
          const set = new Set(where.userId.in);
          rows = rows.filter((r) => set.has(r.userId));
        }
      }
      if (orderBy && orderBy.updatedAt === "desc") {
        rows = rows.slice().sort((a, b) => b.updatedAt - a.updatedAt);
      }
      return rows;
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

const discoverable = require("../api/feed/discoverable.js");
const adjacent = require("../api/feed/adjacent.js");

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
  stytchUserId = "user-self";
  fakeStore.clear();
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL_BRANCH_URL;
  process.env.ANTHROPIC_API_KEY = "test-key";
}

// ── /api/feed/discoverable ────────────────────────────────────────────

test("discoverable rejects non-GET/POST methods", async () => {
  reset();
  const res = fakeRes();
  await discoverable._raw(fakeReq({ method: "DELETE", headers: { authorization: "Bearer t" } }), res);
  assert.equal(res.captured.status, 405);
  assert.equal(res.captured.headers.Allow, "GET, POST");
});

test("discoverable GET returns null when not opted in", async () => {
  reset();
  const res = fakeRes();
  await discoverable._raw(fakeReq({ method: "GET", headers: { authorization: "Bearer t" } }), res);
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.discoverableAt, null);
});

test("discoverable POST optIn:true sets a timestamp; GET reads it back", async () => {
  reset();
  const before = Date.now();
  let res = fakeRes();
  await discoverable._raw(
    fakeReq({ method: "POST", raw: JSON.stringify({ optIn: true }), headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.status, 200);
  const ts = res.captured.body.discoverableAt;
  assert.ok(typeof ts === "string" && ts.length > 0);
  assert.ok(new Date(ts).getTime() >= before);

  res = fakeRes();
  await discoverable._raw(fakeReq({ method: "GET", headers: { authorization: "Bearer t" } }), res);
  assert.equal(res.captured.body.discoverableAt, ts);
});

test("discoverable POST optIn:false nulls the timestamp", async () => {
  reset();
  let res = fakeRes();
  await discoverable._raw(
    fakeReq({ method: "POST", raw: JSON.stringify({ optIn: true }), headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.ok(res.captured.body.discoverableAt);

  res = fakeRes();
  await discoverable._raw(
    fakeReq({ method: "POST", raw: JSON.stringify({ optIn: false }), headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.discoverableAt, null);
});

test("discoverable POST rejects missing optIn", async () => {
  reset();
  const res = fakeRes();
  await discoverable._raw(
    fakeReq({ method: "POST", raw: JSON.stringify({}), headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.status, 400);
});

// ── /api/feed/adjacent ────────────────────────────────────────────────

function seedDiscoverable(userId, optedInAt) {
  fakeStore.set(`${userId}::discoverable`, {
    userId,
    kind: "discoverable",
    data: { discoverableAt: optedInAt },
    updatedAt: new Date(),
  });
}
function seedPublished(userId, slug, title, markdown, updatedAt) {
  fakeStore.set(`${userId}::published:${slug}`, {
    userId,
    kind: `published:${slug}`,
    data: { title, slug, markdown },
    updatedAt: updatedAt || new Date(),
  });
}

test("adjacent rejects non-POST methods", async () => {
  reset();
  const res = fakeRes();
  await adjacent._raw(fakeReq({ method: "GET", headers: { authorization: "Bearer t" } }), res);
  assert.equal(res.captured.status, 405);
});

test("adjacent rejects missing pitchText", async () => {
  reset();
  const res = fakeRes();
  await adjacent._raw(
    fakeReq({ method: "POST", raw: JSON.stringify({}), headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.status, 400);
});

test("adjacent returns coldStart:true when fewer than 3 candidates have published", async () => {
  reset();
  // Two opted-in candidates, only one with a published pitch.
  seedDiscoverable("user-a", "2026-05-01T00:00:00Z");
  seedDiscoverable("user-b", "2026-05-02T00:00:00Z");
  seedPublished("user-a", "alpha", "Alpha", "# Alpha\n\nA pitch about coffee.");
  const res = fakeRes();
  await adjacent._raw(
    fakeReq({
      method: "POST",
      raw: JSON.stringify({ pitchText: "A pitch about something." }),
      headers: { authorization: "Bearer t" },
    }),
    res,
  );
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.coldStart, true);
  assert.deepEqual(res.captured.body.results, []);
});

test("adjacent excludes the requester from candidates", async () => {
  reset();
  // Self + 3 others, all opted in with published pitches.
  seedDiscoverable("user-self", "2026-05-01T00:00:00Z");
  seedPublished("user-self", "self", "Self", "# Self\n\nMy own pitch.");
  for (const u of ["user-a", "user-b"]) {
    seedDiscoverable(u, "2026-05-01T00:00:00Z");
    seedPublished(u, u, u, `# ${u}\n\nA pitch.`);
  }
  // Only 2 non-self candidates → coldStart:true.
  const res = fakeRes();
  await adjacent._raw(
    fakeReq({
      method: "POST",
      raw: JSON.stringify({ pitchText: "Self pitch text." }),
      headers: { authorization: "Bearer t" },
    }),
    res,
  );
  assert.equal(res.captured.body.coldStart, true);
});

test("adjacent calls Claude and returns ranked results with verbatim summaries", async () => {
  reset();
  // 3 non-self candidates with distinct pitch text.
  seedDiscoverable("user-a", "2026-05-01T00:00:00Z");
  seedDiscoverable("user-b", "2026-05-01T00:00:00Z");
  seedDiscoverable("user-c", "2026-05-01T00:00:00Z");
  seedPublished("user-a", "alpha", "Alpha", "# Alpha\n\nA coffee shop for founders who walk to work.");
  seedPublished("user-b", "beta", "Beta", "# Beta\n\nA quiet network for women who code at night.");
  seedPublished("user-c", "gamma", "Gamma", "# Gamma\n\nA marketplace for handmade keyboards.");

  // Stub global fetch to return a Claude-shaped JSON reply.
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            results: [
              { userId: "user-a", oneLineSummary: "A coffee shop for founders who walk to work." },
              { userId: "user-c", oneLineSummary: "A marketplace for handmade keyboards." },
            ],
          }),
        },
      ],
    }),
  });

  try {
    const res = fakeRes();
    await adjacent._raw(
      fakeReq({
        method: "POST",
        raw: JSON.stringify({ pitchText: "A quiet writing tool for founders." }),
        headers: { authorization: "Bearer t" },
      }),
      res,
    );
    assert.equal(res.captured.status, 200, JSON.stringify(res.captured.body));
    assert.equal(res.captured.body.coldStart, false);
    assert.equal(res.captured.body.results.length, 2);
    assert.equal(res.captured.body.results[0].userId, "user-a");
    assert.equal(res.captured.body.results[0].pitchTitle, "Alpha");
    assert.equal(res.captured.body.results[0].pitchSlug, "alpha");
    assert.equal(
      res.captured.body.results[0].oneLineSummary,
      "A coffee shop for founders who walk to work.",
    );
    assert.match(res.captured.body.results[0].viewUrl, /beginner\.work\/daily\/\?u=user-a&t=alpha$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("adjacent falls back to a clean sentence when the model invents a summary", async () => {
  reset();
  seedDiscoverable("user-a", "2026-05-01T00:00:00Z");
  seedDiscoverable("user-b", "2026-05-01T00:00:00Z");
  seedDiscoverable("user-c", "2026-05-01T00:00:00Z");
  seedPublished("user-a", "alpha", "Alpha", "# Alpha\n\nThe one true pitch. About coffee.");
  seedPublished("user-b", "beta", "Beta", "# Beta\n\nA second pitch text.");
  seedPublished("user-c", "gamma", "Gamma", "# Gamma\n\nA third pitch text here.");

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            results: [
              { userId: "user-a", oneLineSummary: "This sentence is nowhere in the pitch text." },
            ],
          }),
        },
      ],
    }),
  });

  try {
    const res = fakeRes();
    await adjacent._raw(
      fakeReq({
        method: "POST",
        raw: JSON.stringify({ pitchText: "Founders pitch." }),
        headers: { authorization: "Bearer t" },
      }),
      res,
    );
    assert.equal(res.captured.body.results.length, 1);
    // Should not return the fabricated sentence; should return a real
    // substring of the candidate's markdown.
    const summary = res.captured.body.results[0].oneLineSummary;
    assert.notEqual(summary, "This sentence is nowhere in the pitch text.");
    assert.ok(summary && summary.length > 0);
  } finally {
    global.fetch = originalFetch;
  }
});

// ── Helper unit tests ─────────────────────────────────────────────────

test("fallbackSummary strips frontmatter and headings", () => {
  const out = adjacent._test.fallbackSummary(
    "---\nmarp: true\n---\n# Title\n\nThe quick brown fox jumps over the lazy dog. Another sentence.",
  );
  assert.match(out, /quick brown fox jumps over the lazy dog/);
  assert.doesNotMatch(out, /Title/);
  assert.doesNotMatch(out, /marp/);
});

test("verbatimIn matches exact and whitespace-normalised sentences", () => {
  const haystack = "Hello world.  Two  spaces.";
  assert.equal(adjacent._test.verbatimIn(haystack, "Hello world."), "Hello world.");
  assert.equal(adjacent._test.verbatimIn(haystack, "Two spaces."), "Two spaces.");
  assert.equal(adjacent._test.verbatimIn(haystack, "Goodbye."), null);
});

test("viewUrlFor swaps tinker-git- prefix for beginner-git- in preview env", () => {
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_BRANCH_URL = "tinker-git-feature-x.vercel.app";
  const url = adjacent._test.viewUrlFor("user-a", "alpha");
  assert.match(url, /^https:\/\/beginner-git-feature-x\.vercel\.app\/daily\/\?u=user-a&t=alpha$/);
});
