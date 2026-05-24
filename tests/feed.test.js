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
        if (Array.isArray(where.OR)) {
          rows = rows.filter((r) =>
            where.OR.some((clause) => {
              if (clause.userId && clause.userId !== r.userId) return false;
              if (clause.kind && clause.kind !== r.kind) return false;
              return true;
            }),
          );
        }
        if (typeof where.kind === "string") {
          rows = rows.filter((r) => r.kind === where.kind);
        } else if (where.kind && typeof where.kind.startsWith === "string") {
          rows = rows.filter((r) => r.kind.startsWith(where.kind.startsWith));
        }
        if (typeof where.userId === "string") {
          rows = rows.filter((r) => r.userId === where.userId);
        } else if (where.userId && Array.isArray(where.userId.in)) {
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
const publishedPitches = require("../api/feed/published-pitches.js");

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
  assert.equal(res.captured.body.pitchSlug, null);
});

test("discoverable POST optIn:true with pitchSlug sets a timestamp; GET reads it back", async () => {
  reset();
  // Picker requires a published row to exist for the picked slug.
  fakeStore.set("user-self::published:mypitch", {
    userId: "user-self",
    kind: "published:mypitch",
    data: { slug: "mypitch", title: "MyPitch", markdown: "# MyPitch\n\nA short pitch." },
    updatedAt: new Date(),
  });
  const before = Date.now();
  let res = fakeRes();
  await discoverable._raw(
    fakeReq({ method: "POST", raw: JSON.stringify({ optIn: true, pitchSlug: "mypitch" }), headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.status, 200, JSON.stringify(res.captured.body));
  const ts = res.captured.body.discoverableAt;
  assert.ok(typeof ts === "string" && ts.length > 0);
  assert.ok(new Date(ts).getTime() >= before);
  assert.equal(res.captured.body.pitchSlug, "mypitch");

  res = fakeRes();
  await discoverable._raw(fakeReq({ method: "GET", headers: { authorization: "Bearer t" } }), res);
  assert.equal(res.captured.body.discoverableAt, ts);
  assert.equal(res.captured.body.pitchSlug, "mypitch");
});

test("discoverable POST optIn:true rejects when the slug isn't a published pitch", async () => {
  reset();
  const res = fakeRes();
  await discoverable._raw(
    fakeReq({ method: "POST", raw: JSON.stringify({ optIn: true, pitchSlug: "ghost" }), headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.status, 400);
});

test("discoverable POST optIn:true rejects when pitchSlug is missing", async () => {
  reset();
  const res = fakeRes();
  await discoverable._raw(
    fakeReq({ method: "POST", raw: JSON.stringify({ optIn: true }), headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.status, 400);
});

test("discoverable POST optIn:false nulls the timestamp and slug", async () => {
  reset();
  fakeStore.set("user-self::published:mypitch", {
    userId: "user-self",
    kind: "published:mypitch",
    data: { slug: "mypitch", title: "MyPitch", markdown: "# MyPitch\n\nA short pitch." },
    updatedAt: new Date(),
  });
  let res = fakeRes();
  await discoverable._raw(
    fakeReq({ method: "POST", raw: JSON.stringify({ optIn: true, pitchSlug: "mypitch" }), headers: { authorization: "Bearer t" } }),
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
  assert.equal(res.captured.body.pitchSlug, null);
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

function seedDiscoverable(userId, optedInAt, pitchSlug) {
  fakeStore.set(`${userId}::discoverable`, {
    userId,
    kind: "discoverable",
    data: { discoverableAt: optedInAt, pitchSlug: pitchSlug || null },
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
// Self is always opted in + has a published pitch for the adjacency
// tests — the endpoint now reads the requester's pitch from their own
// discoverable row, so self has to be opted in to call it at all.
function seedSelf() {
  seedPublished("user-self", "self", "Self", "# Self\n\nA quiet writing tool for founders.");
  seedDiscoverable("user-self", "2026-05-01T00:00:00Z", "self");
}

test("adjacent rejects non-POST methods", async () => {
  reset();
  const res = fakeRes();
  await adjacent._raw(fakeReq({ method: "GET", headers: { authorization: "Bearer t" } }), res);
  assert.equal(res.captured.status, 405);
});

test("adjacent 400s when the requester isn't opted in to a pitch", async () => {
  reset();
  const res = fakeRes();
  await adjacent._raw(
    fakeReq({ method: "POST", raw: "{}", headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.status, 400);
});

test("adjacent returns coldStart:true when fewer than 3 candidates have published", async () => {
  reset();
  seedSelf();
  // Two opted-in candidates, only one with a matching published pitch.
  seedDiscoverable("user-a", "2026-05-01T00:00:00Z", "alpha");
  seedPublished("user-a", "alpha", "Alpha", "# Alpha\n\nA pitch about coffee.");
  seedDiscoverable("user-b", "2026-05-02T00:00:00Z", "beta"); // no published row
  const res = fakeRes();
  await adjacent._raw(
    fakeReq({ method: "POST", raw: "{}", headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.coldStart, true);
  assert.deepEqual(res.captured.body.results, []);
});

test("adjacent excludes the requester from candidates", async () => {
  reset();
  seedSelf();
  for (const u of ["user-a", "user-b"]) {
    seedDiscoverable(u, "2026-05-01T00:00:00Z", u);
    seedPublished(u, u, u, `# ${u}\n\nA pitch.`);
  }
  const res = fakeRes();
  await adjacent._raw(
    fakeReq({ method: "POST", raw: "{}", headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.body.coldStart, true);
});

test("adjacent skips candidates whose pitchSlug no longer maps to a published row", async () => {
  reset();
  seedSelf();
  // user-a opted in with a slug that doesn't have a published row.
  seedDiscoverable("user-a", "2026-05-01T00:00:00Z", "ghost");
  seedDiscoverable("user-b", "2026-05-01T00:00:00Z", "beta");
  seedPublished("user-b", "beta", "Beta", "# Beta\n\nA real pitch.");
  seedDiscoverable("user-c", "2026-05-01T00:00:00Z", "gamma");
  seedPublished("user-c", "gamma", "Gamma", "# Gamma\n\nAnother real pitch.");
  const res = fakeRes();
  await adjacent._raw(
    fakeReq({ method: "POST", raw: "{}", headers: { authorization: "Bearer t" } }),
    res,
  );
  // Only 2 valid candidates → coldStart:true.
  assert.equal(res.captured.body.coldStart, true);
});

test("adjacent calls Claude and returns ranked results with verbatim summaries", async () => {
  reset();
  seedSelf();
  // 3 non-self candidates with distinct pitch text.
  seedDiscoverable("user-a", "2026-05-01T00:00:00Z", "alpha");
  seedDiscoverable("user-b", "2026-05-01T00:00:00Z", "beta");
  seedDiscoverable("user-c", "2026-05-01T00:00:00Z", "gamma");
  seedPublished("user-a", "alpha", "Alpha", "# Alpha\n\nA coffee shop for founders who walk to work.");
  seedPublished("user-b", "beta", "Beta", "# Beta\n\nA quiet network for women who code at night.");
  seedPublished("user-c", "gamma", "Gamma", "# Gamma\n\nA marketplace for handmade keyboards.");

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
      fakeReq({ method: "POST", raw: "{}", headers: { authorization: "Bearer t" } }),
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
  seedSelf();
  seedDiscoverable("user-a", "2026-05-01T00:00:00Z", "alpha");
  seedDiscoverable("user-b", "2026-05-01T00:00:00Z", "beta");
  seedDiscoverable("user-c", "2026-05-01T00:00:00Z", "gamma");
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
      fakeReq({ method: "POST", raw: "{}", headers: { authorization: "Bearer t" } }),
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

// ── /api/feed/published-pitches ───────────────────────────────────────

test("published-pitches rejects non-GET methods", async () => {
  reset();
  const res = fakeRes();
  await publishedPitches._raw(
    fakeReq({ method: "POST", headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.status, 405);
});

test("published-pitches returns an empty list when the founder has none", async () => {
  reset();
  const res = fakeRes();
  await publishedPitches._raw(
    fakeReq({ method: "GET", headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.status, 200);
  assert.deepEqual(res.captured.body, { pitches: [] });
});

test("published-pitches lists the founder's published rows, most recent first", async () => {
  reset();
  // Set updatedAt explicitly so the ordering is deterministic.
  seedPublished("user-self", "old", "Old", "# Old\n\nx", new Date("2026-01-01T00:00:00Z"));
  seedPublished("user-self", "new", "New", "# New\n\nx", new Date("2026-05-01T00:00:00Z"));
  // Another user's row should not leak in.
  seedPublished("user-other", "other", "Other", "# Other\n\nx", new Date("2026-06-01T00:00:00Z"));
  const res = fakeRes();
  await publishedPitches._raw(
    fakeReq({ method: "GET", headers: { authorization: "Bearer t" } }),
    res,
  );
  assert.equal(res.captured.status, 200);
  assert.equal(res.captured.body.pitches.length, 2);
  assert.equal(res.captured.body.pitches[0].slug, "new");
  assert.equal(res.captured.body.pitches[1].slug, "old");
  assert.equal(res.captured.body.pitches[0].title, "New");
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

test("viewUrlFor uses beginner's main preview alias in preview env", () => {
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_BRANCH_URL = "tinker-git-feature-x.vercel.app";
  const url = adjacent._test.viewUrlFor("user-a", "alpha");
  assert.match(
    url,
    /^https:\/\/beginner-git-main-beginner-work\.vercel\.app\/daily\/\?u=user-a&t=alpha$/,
  );
});
