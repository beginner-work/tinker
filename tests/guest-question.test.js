/* Unit tests for /api/claude/guest.
 *
 * The Anthropic call itself isn't exercised — what's under test is the
 * contract that makes this endpoint safe to expose without auth: the
 * server owns the prompt, client input is normalised and hard-capped,
 * a finished guest interview (three answers) is refused, and the
 * per-IP rate limit closes the free-compute loophole.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test__ } = require("../api/claude/guest.js");
const {
  MAX_TURNS,
  RATE_LIMIT,
  RATE_WINDOW_MS,
  SYSTEM_PROMPT,
  normalizeInput,
  buildUserMessage,
  checkRateLimit,
  buckets,
} = __test__;

test("the guest interview is three turns, matching the client cap", () => {
  assert.equal(MAX_TURNS, 3);
});

test("normalizeInput keeps a well-formed payload, capped", () => {
  const out = normalizeInput({
    entryId: "e".repeat(200),
    seed: "s".repeat(500),
    transcript: [
      { q: "What are you learning?", a: "That mornings matter." },
      "junk",
      { q: "  ", a: "no question" },
    ],
  });
  assert.equal(out.entryId.length, 64);
  assert.equal(out.seed.length, 120);
  assert.equal(out.transcript.length, 1);
  assert.deepEqual(out.transcript[0], { q: "What are you learning?", a: "That mornings matter." });
});

test("normalizeInput refuses a finished interview (three answers)", () => {
  const turns = Array.from({ length: 3 }, (_, i) => ({ q: `Q${i}`, a: `A${i}` }));
  assert.equal(normalizeInput({ transcript: turns }), null);
  // …and ignores anything past the cap rather than reading it.
  assert.equal(normalizeInput({ transcript: [...turns, { q: "Q4", a: "A4" }] }), null);
});

test("normalizeInput tolerates a missing/empty payload shape", () => {
  assert.equal(normalizeInput(null), null);
  assert.equal(normalizeInput("string"), null);
  const bare = normalizeInput({});
  assert.deepEqual(bare, { seed: "", entryId: "", transcript: [] });
});

test("the system prompt is server-owned and question-shaped", () => {
  assert.match(SYSTEM_PROMPT, /Output ONLY the question/);
  assert.match(SYSTEM_PROMPT, /learning/);
  assert.match(SYSTEM_PROMPT, /follow from them/);
});

test("buildUserMessage: opener carries the scene, no transcript", () => {
  const msg = buildUserMessage({ seed: "Cafe", transcript: [] });
  assert.match(msg, /Where the founder is right now: Cafe/);
  assert.match(msg, /opening question/);
  assert.doesNotMatch(msg, /Conversation so far/);
});

test("buildUserMessage: follow-ups carry the verbatim turns and the 3-question frame", () => {
  const msg = buildUserMessage({
    seed: "",
    transcript: [
      { q: "What are you learning?", a: "Customers care about speed." },
      { q: "What surprised you?", a: "The pricing page traffic." },
    ],
  });
  assert.match(msg, /Q1: What are you learning\?/);
  assert.match(msg, /A2: The pricing page traffic\./);
  assert.match(msg, /Ask question 3 of 3/);
  assert.match(msg, /follow from the answers above/);
});

test("checkRateLimit allows the budget then refuses, and resets after the window", () => {
  buckets.clear();
  let now = 1_000_000;
  const nowFn = () => now;
  for (let i = 0; i < RATE_LIMIT; i++) {
    assert.equal(checkRateLimit("1.2.3.4", nowFn), true, `call ${i + 1} should pass`);
  }
  assert.equal(checkRateLimit("1.2.3.4", nowFn), false, "over-budget call should be refused");
  // A different IP has its own bucket.
  assert.equal(checkRateLimit("5.6.7.8", nowFn), true);
  // The window rolling over resets the bucket.
  now += RATE_WINDOW_MS + 1;
  assert.equal(checkRateLimit("1.2.3.4", nowFn), true);
  buckets.clear();
});
