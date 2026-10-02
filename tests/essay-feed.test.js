/* Unit tests for the private mobile essay feed helpers + audio cache. */

"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const feed = require("../api/_lib/essay-feed.js");

const ORIGINAL_ENV = {
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  ELEVEN_API_KEY: process.env.ELEVEN_API_KEY,
  ELEVENLABS_VOICE_ID: process.env.ELEVENLABS_VOICE_ID,
};

function clearVoiceEnv() {
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.ELEVEN_API_KEY;
  delete process.env.ELEVENLABS_VOICE_ID;
}

function restoreVoiceEnv() {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  clearVoiceEnv();
});

afterEach(() => {
  restoreVoiceEnv();
});

test("extractBodyText recovers text from object bodies and skips [object Object]", () => {
  assert.equal(feed.extractBodyText({ body: "plain prose" }), "plain prose");
  assert.equal(
    feed.extractBodyText({ body: { text: "from object" } }),
    "from object",
  );
  assert.equal(
    feed.extractBodyText({ body: { content: "nested content" } }),
    "nested content",
  );
  assert.equal(feed.extractBodyText({ body: "[object Object]" }), "");
  assert.equal(
    feed.extractBodyText({
      body: "[object Object]",
      stitched: { body: "recovered from stitched" },
    }),
    "recovered from stitched",
  );
  assert.equal(feed.extractBodyText({ body: { nested: true } }), "");
  assert.equal(
    feed.extractBodyText({ body: [{ text: "a" }, { body: "b" }] }),
    "a\n\nb",
  );
});

test("filter drops test essays, empty drafts, archived, and [object Object]", () => {
  const essays = [
    { id: "e1", title: "Real one", body: "I built something quiet today.", createdAt: 3000 },
    { id: "e2", title: "test", body: "should drop", createdAt: 2900 },
    { id: "e3", title: "Fixture", body: "x", test: true, createdAt: 2800 },
    { id: "e4", title: "Empty", body: "", createdAt: 2700 },
    { id: "e5", title: "Broken", body: "[object Object]", createdAt: 2600 },
    { id: "e6", title: "Archived", body: "still here", archived: true, createdAt: 2500 },
    { id: "e7", title: "Lorem", body: "Lorem ipsum dolor sit amet", createdAt: 2400 },
    { id: "e8", title: "[test] seed", body: "noise", createdAt: 2300 },
    {
      id: "e9",
      title: "Recovered",
      body: "[object Object]",
      stitched: { body: "The real words survived the bad serialize." },
      createdAt: 2200,
    },
    { id: "e10", title: "Untitled", body: "   ", createdAt: 2100 },
  ];

  const items = feed.buildFeedItems(essays, { starredIds: ["e1"] });
  const ids = items.map((i) => i.id);
  assert.deepEqual(ids, ["e1", "e9"]);
  assert.equal(items[0].starred, true);
  assert.equal(items[1].starred, false);
  assert.equal(items.every((i) => i.body !== "[object Object]"), true);
});

test("buildFeedItems orders newest first", () => {
  const essays = [
    { id: "old", title: "Older", body: "I wrote this first on a quiet morning walk.", createdAt: 1000 },
    { id: "new", title: "Newer", body: "I wrote this later when the light was gone.", createdAt: 2000 },
  ];
  const items = feed.buildFeedItems(essays);
  assert.deepEqual(items.map((i) => i.id), ["new", "old"]);
});

test("pickHeadline uses feedHeadline override when set", () => {
  const picked = feed.pickHeadline({
    title: "A soft title",
    body: "I walked home in the rain. The porch light was on.",
    feedHeadline: "Manual headline for later",
  });
  assert.equal(picked.headline, "Manual headline for later");
  assert.equal(picked.source, "override");
});

test("pickHeadline chooses a strong deterministic line from the body", () => {
  const essay = {
    title: "Untitled",
    body: [
      "And then.",
      "I kept the notebook in my coat pocket all winter.",
      "todo: fix this later somehow please",
    ].join("\n\n"),
  };
  const a = feed.pickHeadline(essay);
  const b = feed.pickHeadline(essay);
  assert.equal(a.headline, b.headline);
  assert.equal(a.source, "heuristic");
  assert.match(a.headline, /notebook/i);
});

test("star toggle adds and removes without duplicates", () => {
  let ids = [];
  ids = feed.toggleStar(ids, "e1", true);
  ids = feed.toggleStar(ids, "e1", true);
  ids = feed.toggleStar(ids, "e2", true);
  assert.deepEqual(ids, ["e1", "e2"]);
  ids = feed.toggleStar(ids, "e1", false);
  assert.deepEqual(ids, ["e2"]);
  assert.deepEqual(feed.normalizeStarIds({ essayIds: ["a", "a", "", null] }), ["a"]);
});

test("audioFeatureEnabled requires both key and voice id", () => {
  assert.equal(feed.audioFeatureEnabled(), false);
  process.env.ELEVENLABS_API_KEY = "sk_test";
  assert.equal(feed.audioFeatureEnabled(), false);
  process.env.ELEVENLABS_VOICE_ID = "voice_abc";
  assert.equal(feed.audioFeatureEnabled(), true);
});

test("getOrCreateAudio caches on first play and skips generate on second", async () => {
  process.env.ELEVENLABS_API_KEY = "sk_test";
  process.env.ELEVENLABS_VOICE_ID = "voice_abc";

  const store = new Map();
  let generateCalls = 0;

  const readCache = async (essayId, voiceId) => store.get(`${essayId}::${voiceId}`) || null;
  const writeCache = async (row) => {
    store.set(`${row.essayId}::${row.voiceId}`, row);
  };
  const generateFn = async () => {
    generateCalls += 1;
    return { audioBase64: "YXVkaW8=", contentType: "audio/mpeg" };
  };

  const first = await feed.getOrCreateAudio({
    essayId: "e1",
    voiceId: "voice_abc",
    text: "Hello from the essay body.",
    readCache,
    writeCache,
    generateFn,
  });
  assert.equal(first.cached, false);
  assert.equal(generateCalls, 1);

  const second = await feed.getOrCreateAudio({
    essayId: "e1",
    voiceId: "voice_abc",
    text: "Hello from the essay body.",
    readCache,
    writeCache,
    generateFn,
  });
  assert.equal(second.cached, true);
  assert.equal(generateCalls, 1, "second play must not call ElevenLabs again");
  assert.equal(second.audioBase64, "YXVkaW8=");
});

test("getOrCreateAudio cache key includes voice id", async () => {
  process.env.ELEVENLABS_API_KEY = "sk_test";
  process.env.ELEVENLABS_VOICE_ID = "voice_old";

  const store = new Map();
  let generateCalls = 0;
  const readCache = async (essayId, voiceId) => store.get(`${essayId}::${voiceId}`) || null;
  const writeCache = async (row) => {
    store.set(`${row.essayId}::${row.voiceId}`, row);
  };
  const generateFn = async ({ voiceId }) => {
    generateCalls += 1;
    return { audioBase64: Buffer.from(voiceId).toString("base64"), contentType: "audio/mpeg" };
  };

  await feed.getOrCreateAudio({
    essayId: "e1",
    voiceId: "voice_old",
    text: "Same essay, first voice.",
    readCache,
    writeCache,
    generateFn,
  });
  process.env.ELEVENLABS_VOICE_ID = "voice_new";
  await feed.getOrCreateAudio({
    essayId: "e1",
    voiceId: "voice_new",
    text: "Same essay, new voice.",
    readCache,
    writeCache,
    generateFn,
  });
  assert.equal(generateCalls, 2, "new voice id must miss the old cache entry");
  assert.equal(store.has("e1::voice_old"), true);
  assert.equal(store.has("e1::voice_new"), true);
});

test("callElevenLabsTts uses env voice id and never hard-codes a name", async () => {
  process.env.ELEVENLABS_API_KEY = "sk_test";
  process.env.ELEVENLABS_VOICE_ID = "voice_from_env";

  let seenUrl = "";
  let seenKey = "";
  const fetchFn = async (url, opts) => {
    seenUrl = url;
    seenKey = opts.headers["xi-api-key"];
    return {
      ok: true,
      headers: { get: () => "audio/mpeg" },
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    };
  };

  const out = await feed.callElevenLabsTts({
    text: "Read this quietly.",
    fetchFn,
  });
  assert.match(seenUrl, /voice_from_env/);
  assert.equal(seenKey, "sk_test");
  assert.equal(out.contentType, "audio/mpeg");
  assert.ok(out.audioBase64);

  // Guard against accidental hard-coded professional voice naming.
  const src = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../api/_lib/essay-feed.js"),
    "utf8",
  );
  assert.equal(/Tyler Lindow \(professional\)/i.test(src), false);
  assert.equal(/Tyler Lindow/i.test(src), false);
});

test("feed page ships noindex and hides play until feature check", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(
    path.resolve(__dirname, "../src/renderer/feed/index.html"),
    "utf8",
  );
  const js = fs.readFileSync(
    path.resolve(__dirname, "../src/renderer/feed/feed.js"),
    "utf8",
  );
  const auth = fs.readFileSync(
    path.resolve(__dirname, "../src/renderer/auth.js"),
    "utf8",
  );
  const sw = fs.readFileSync(
    path.resolve(__dirname, "../src/renderer/sw.js"),
    "utf8",
  );
  const vercel = fs.readFileSync(
    path.resolve(__dirname, "../vercel.json"),
    "utf8",
  );
  assert.match(html, /noindex/);
  assert.match(js, /audioEnabled/);
  assert.match(js, /playBtn\.hidden = !state\.audioEnabled/);
  assert.match(js, /sessionStorage.setItem\(RETURN_KEY, "\/feed"\)/);
  assert.match(auth, /path !== "\/feed"/);
  assert.match(sw, /pathname === "\/feed"/);
  assert.match(vercel, /\/feed\/index.html/);
  assert.equal(/Tyler Lindow \(professional\)/i.test(js), false);
  assert.equal(/Tyler Lindow \(professional\)/i.test(html), false);
});
