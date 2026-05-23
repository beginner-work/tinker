/* Unit tests for /api/alt-pitches's validation + reconciliation.
 *
 * The endpoint itself calls Anthropic, which we don't exercise here.
 * The pure helpers — title validation, input normalisation, and the
 * reconcile pass that enforces "every input id lands in exactly one
 * bucket" — are the contract the route holds the model to. Anything
 * the model returns has to clear these checks or get dropped.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test__ } = require("../api/alt-pitches/index.js");
const {
  MAX_WRITINGS,
  MAX_BUCKETS,
  validateTitle,
  reconcilePitches,
  parseClassifierJson,
  normalizeInputs,
  buildSystemPrompt,
} = __test__;

test("validateTitle accepts a single capitalized 3–14 letter word", () => {
  assert.equal(validateTitle("Craft"), "Craft");
  assert.equal(validateTitle("Doubt"), "Doubt");
  assert.equal(validateTitle("Friendship"), "Friendship");
  // 14 letters total → first cap + 13 lower
  assert.equal(validateTitle("Aaaaaaaaaaaaaa"), "Aaaaaaaaaaaaaa");
});

test("validateTitle rejects phrases, hyphens, casing variants, and empty values", () => {
  assert.equal(validateTitle("the craft"), null);
  assert.equal(validateTitle("Craft Money"), null);
  assert.equal(validateTitle("co-founder"), null);
  assert.equal(validateTitle("craft"), null);
  assert.equal(validateTitle("CRAFT"), null);
  assert.equal(validateTitle("Cr"), null); // too short
  assert.equal(validateTitle("Aaaaaaaaaaaaaaa"), null); // 15 letters
  assert.equal(validateTitle(""), null);
  assert.equal(validateTitle(null), null);
  assert.equal(validateTitle(123), null);
});

test("reconcilePitches keeps only valid titles and known ids", () => {
  const inputIds = ["e_1", "e_2", "e_3"];
  const parsed = {
    pitches: [
      { title: "Craft", writingIds: ["e_1", "e_2"] },
      { title: "money flow", writingIds: ["e_3"] }, // invalid title, dropped
    ],
  };
  const out = reconcilePitches(parsed, inputIds);
  // Invalid-title bucket dropped, its id swept into the first valid
  // bucket so no founder writing is orphaned.
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Craft");
  assert.deepEqual(out[0].writingIds.sort(), ["e_1", "e_2", "e_3"]);
});

test("reconcilePitches dedupes ids across buckets, first bucket wins", () => {
  const inputIds = ["a", "b", "c"];
  const parsed = {
    pitches: [
      { title: "First", writingIds: ["a", "b"] },
      { title: "Second", writingIds: ["b", "c"] },
    ],
  };
  const out = reconcilePitches(parsed, inputIds);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].writingIds, ["a", "b"]);
  assert.deepEqual(out[1].writingIds, ["c"]);
});

test("reconcilePitches drops unknown ids the model invented", () => {
  const inputIds = ["a", "b"];
  const parsed = {
    pitches: [
      { title: "First", writingIds: ["a", "ghost"] },
      { title: "Second", writingIds: ["b"] },
    ],
  };
  const out = reconcilePitches(parsed, inputIds);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].writingIds, ["a"]);
  assert.deepEqual(out[1].writingIds, ["b"]);
});

test("reconcilePitches sweeps leftover ids into the first valid bucket", () => {
  const inputIds = ["a", "b", "c", "d"];
  const parsed = {
    pitches: [
      { title: "First", writingIds: ["a"] },
      { title: "Second", writingIds: ["b"] },
    ],
  };
  const out = reconcilePitches(parsed, inputIds);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].writingIds.sort(), ["a", "c", "d"]);
  assert.deepEqual(out[1].writingIds, ["b"]);
});

test("reconcilePitches falls back to a single 'Other' bucket when nothing validates", () => {
  const inputIds = ["a", "b"];
  const parsed = {
    pitches: [
      { title: "lower", writingIds: ["a"] },
      { title: "Two Words", writingIds: ["b"] },
    ],
  };
  const out = reconcilePitches(parsed, inputIds);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Other");
  assert.deepEqual(out[0].writingIds.sort(), ["a", "b"]);
});

test("reconcilePitches caps at MAX_BUCKETS", () => {
  const inputIds = ["a", "b", "c", "d", "e", "f", "g"];
  const parsed = {
    pitches: [
      { title: "One", writingIds: ["a"] },
      { title: "Two", writingIds: ["b"] },
      { title: "Three", writingIds: ["c"] },
      { title: "Four", writingIds: ["d"] },
      { title: "Five", writingIds: ["e"] },
    ],
  };
  const out = reconcilePitches(parsed, inputIds);
  assert.equal(out.length, MAX_BUCKETS);
  // Leftover ids (e, f, g) all sweep into the first bucket.
  assert.ok(out[0].writingIds.includes("e"));
  assert.ok(out[0].writingIds.includes("f"));
  assert.ok(out[0].writingIds.includes("g"));
});

test("normalizeInputs drops empty bodies, dedupes by id, truncates long snippets", () => {
  const longBody = "x".repeat(2000);
  const out = normalizeInputs([
    { id: "e_1", snippet: "hello" },
    { id: "e_1", snippet: "duplicate id, dropped" },
    { id: "e_2", snippet: "   " },        // blank, dropped
    { id: "e_3", snippet: longBody },
    { id: "", snippet: "missing id, dropped" },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, "e_1");
  assert.equal(out[0].snippet, "hello");
  assert.equal(out[1].id, "e_3");
  assert.ok(out[1].snippet.length < longBody.length);
  assert.ok(out[1].snippet.endsWith("…"));
});

test("normalizeInputs caps at MAX_WRITINGS", () => {
  const arr = [];
  for (let i = 0; i < MAX_WRITINGS + 10; i++) {
    arr.push({ id: `e_${i}`, snippet: `body ${i}` });
  }
  const out = normalizeInputs(arr);
  assert.equal(out.length, MAX_WRITINGS);
});

test("parseClassifierJson strips code fences", () => {
  const fenced = "```json\n{\"pitches\":[]}\n```";
  assert.deepEqual(parseClassifierJson(fenced), { pitches: [] });
  const plain = "{\"pitches\":[{\"title\":\"Craft\",\"writingIds\":[\"a\"]}]}";
  assert.deepEqual(parseClassifierJson(plain), {
    pitches: [{ title: "Craft", writingIds: ["a"] }],
  });
  assert.equal(parseClassifierJson("not json"), null);
});

test("system prompt enforces the one-word title contract", () => {
  const sys = buildSystemPrompt();
  assert.ok(sys.includes("EXACTLY ONE WORD"));
  assert.ok(sys.includes("3 to 14 letters"));
  assert.ok(sys.includes("exactly one cluster"));
  assert.ok(sys.includes("1 to 4 alternate pitches"));
});
