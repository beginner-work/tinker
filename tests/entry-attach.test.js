/* Unit tests for /api/entry/attach.
 *
 * The endpoint itself talks to Stytch + Postgres, which we don't
 * exercise here. The pure helpers — entry normalisation (the shape the
 * anonymous guest entry must clear to be stored) and the idempotent
 * merge that ties an entry to the account without ever duplicating or
 * re-claiming it — are the contract the route holds the client to.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test__ } = require("../api/entry/attach.js");
const { KIND, MAX_ENTRIES, MAX_ANSWERS, normalizeEntry, mergeEntries } = __test__;

test("entries land under the 'entries' kind", () => {
  assert.equal(KIND, "entries");
});

test("normalizeEntry keeps a well-formed entry intact", () => {
  const out = normalizeEntry({
    id: "abc-123",
    createdAt: 1700000000000,
    location: "Cafe",
    answers: [
      { q: "What are you learning?", a: "That mornings are for hard things.", at: 1700000001000 },
    ],
  });
  assert.deepEqual(out, {
    id: "abc-123",
    createdAt: 1700000000000,
    location: "Cafe",
    answers: [
      { q: "What are you learning?", a: "That mornings are for hard things.", at: 1700000001000 },
    ],
  });
});

test("normalizeEntry rejects entries with no id", () => {
  assert.equal(normalizeEntry(null), null);
  assert.equal(normalizeEntry({}), null);
  assert.equal(normalizeEntry({ id: "", location: "Cafe" }), null);
  assert.equal(normalizeEntry({ id: 42, location: "Cafe" }), null);
});

test("normalizeEntry rejects entries with nothing attributable", () => {
  // An id alone carries no first-touch signal — no location, no answers.
  assert.equal(normalizeEntry({ id: "abc" }), null);
  assert.equal(normalizeEntry({ id: "abc", location: "   ", answers: [] }), null);
  // Answers missing either half don't count.
  assert.equal(
    normalizeEntry({ id: "abc", answers: [{ q: "only a question" }, { a: "only an answer" }] }),
    null
  );
});

test("normalizeEntry accepts location-only and answers-only entries", () => {
  const locOnly = normalizeEntry({ id: "abc", location: "Home" });
  assert.equal(locOnly.location, "Home");
  assert.deepEqual(locOnly.answers, []);

  const ansOnly = normalizeEntry({
    id: "abc",
    answers: [{ q: "Q", a: "A" }],
  });
  assert.equal(ansOnly.location, null);
  assert.equal(ansOnly.answers.length, 1);
  assert.equal(ansOnly.answers[0].at, null);
});

test("normalizeEntry clamps oversized fields and drops malformed turns", () => {
  const out = normalizeEntry({
    id: "x".repeat(200),
    createdAt: "not-a-number",
    location: "y".repeat(500),
    answers: [
      { q: "q".repeat(1000), a: "a".repeat(10000), at: -5 },
      "not-an-object",
      { q: "  ", a: "trimmed away" },
    ],
  });
  assert.equal(out.id.length, 64);
  assert.equal(out.createdAt, null);
  assert.equal(out.location.length, 120);
  assert.equal(out.answers.length, 1);
  assert.equal(out.answers[0].q.length, 300);
  assert.equal(out.answers[0].a.length, 4000);
  assert.equal(out.answers[0].at, null);
});

test("normalizeEntry caps the number of answers", () => {
  const answers = Array.from({ length: 30 }, (_, i) => ({ q: `Q${i}`, a: `A${i}` }));
  const out = normalizeEntry({ id: "abc", answers });
  assert.equal(out.answers.length, MAX_ANSWERS);
});

test("mergeEntries appends a new entry with the attach stamps", () => {
  const merged = mergeEntries(null, { id: "e1", location: "Cafe", answers: [] }, {
    attachedAt: 1000,
    sessionId: "sess-1",
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "e1");
  assert.equal(merged[0].attachedAt, 1000);
  assert.equal(merged[0].sessionId, "sess-1");
});

test("mergeEntries is idempotent — the first claim stays the claim of record", () => {
  const first = mergeEntries(null, { id: "e1", location: "Cafe", answers: [] }, {
    attachedAt: 1000,
    sessionId: "sess-1",
  });
  // Retried attach (or a second verify on the same device) refreshes
  // content but keeps the original attachedAt + sessionId.
  const again = mergeEntries(
    first,
    { id: "e1", location: "Cafe", answers: [{ q: "Q", a: "A", at: null }] },
    { attachedAt: 2000, sessionId: "sess-2" }
  );
  assert.equal(again.length, 1);
  assert.equal(again[0].attachedAt, 1000);
  assert.equal(again[0].sessionId, "sess-1");
  assert.equal(again[0].answers.length, 1);
});

test("mergeEntries keeps distinct entries and drops junk rows", () => {
  const existing = [
    { id: "e1", location: "Cafe", attachedAt: 1, sessionId: "s1" },
    null,
    "junk",
    { location: "no id" },
  ];
  const merged = mergeEntries(existing, { id: "e2", location: "Home", answers: [] }, {
    attachedAt: 2,
    sessionId: "s2",
  });
  assert.deepEqual(merged.map((e) => e.id), ["e1", "e2"]);
});

test("mergeEntries caps the stored list at MAX_ENTRIES, oldest out first", () => {
  const existing = Array.from({ length: MAX_ENTRIES }, (_, i) => ({
    id: `e${i}`,
    location: "Cafe",
    attachedAt: i,
    sessionId: "s",
  }));
  const merged = mergeEntries(existing, { id: "fresh", location: "Home", answers: [] }, {
    attachedAt: 999,
    sessionId: "s",
  });
  assert.equal(merged.length, MAX_ENTRIES);
  assert.equal(merged[merged.length - 1].id, "fresh");
  assert.equal(merged.find((e) => e.id === "e0"), undefined);
});
