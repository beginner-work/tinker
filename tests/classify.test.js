/* Unit tests for the v0.103 classifier's validation logic.
 *
 * The endpoint itself calls Anthropic, which we don't exercise here —
 * but the heading + phrase validators are pure functions and they're
 * the contract the classifier enforces against the LLM. Anything the
 * model returns has to clear these checks or get dropped.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test__ } = require("../api/classify/index.js");
const {
  DECK_HEADINGS,
  HEADING_DESCRIPTIONS,
  validatePhrase,
  validateHeading,
  parseClassifierJson,
  buildSystemPrompt,
} = __test__;

test("the seven deck headings are spelled exactly as in pitch-deck.md", () => {
  assert.deepEqual(DECK_HEADINGS, [
    "The Problem",
    "Why Now?",
    "The Product",
    "How We Make Money",
    "The Moat",
    "Competition",
    "The Ask",
  ]);
});

test("each heading has a non-trivial description", () => {
  for (const h of DECK_HEADINGS) {
    const d = HEADING_DESCRIPTIONS[h];
    assert.ok(d, `${h} missing description`);
    assert.ok(d.length > 40, `${h} description too short`);
  }
});

test("system prompt names every heading and quotes its description", () => {
  const sys = buildSystemPrompt();
  for (const h of DECK_HEADINGS) {
    assert.ok(sys.includes(`- ${h}`), `system prompt missing heading: ${h}`);
    const desc = HEADING_DESCRIPTIONS[h];
    const head = desc.slice(0, 24);
    assert.ok(sys.includes(head), `system prompt missing description fragment for ${h}: ${head}`);
  }
});

test("validateHeading accepts exact literals, rejects paraphrases, allows null", () => {
  assert.equal(validateHeading("The Problem"), "The Problem");
  assert.equal(validateHeading("Why Now?"), "Why Now?");
  assert.equal(validateHeading(null), null);
  // Paraphrases / case changes / drop-articles → rejected.
  assert.equal(validateHeading("the problem"), undefined);
  assert.equal(validateHeading("Problem"), undefined);
  assert.equal(validateHeading("Why now"), undefined);
  assert.equal(validateHeading(""), undefined);
  assert.equal(validateHeading(undefined), undefined);
});

test("validatePhrase accepts a clean 4–18 word substring", () => {
  const body = "the barber gave me a hundred bucks and i didn't know what to say";
  const phrase = "the barber gave me a hundred bucks";
  const offset = body.indexOf(phrase);
  const length = phrase.length;
  assert.deepEqual(validatePhrase(body, { offset, length }), { offset, length });
});

test("validatePhrase rejects a substring that starts mid-word", () => {
  const body = "the barber gave me a hundred bucks";
  const phrase = "arber gave me a hundred";
  const offset = body.indexOf(phrase);
  const length = phrase.length;
  assert.equal(validatePhrase(body, { offset, length }), null);
});

test("validatePhrase rejects a substring that ends mid-word", () => {
  const body = "the barber gave me a hundred bucks";
  // Cuts off "buc" mid-word.
  const offset = 0;
  const length = "the barber gave me a hundred buc".length;
  assert.equal(validatePhrase(body, { offset, length }), null);
});

test("validatePhrase rejects offset past the body", () => {
  const body = "short body";
  assert.equal(validatePhrase(body, { offset: 4, length: 50 }), null);
  assert.equal(validatePhrase(body, { offset: -1, length: 5 }), null);
});

test("validatePhrase rejects fewer than 4 words", () => {
  const body = "the barber gave me a hundred bucks";
  const phrase = "the barber gave";
  const offset = body.indexOf(phrase);
  assert.equal(validatePhrase(body, { offset, length: phrase.length }), null);
});

test("validatePhrase rejects more than 18 words", () => {
  const body = Array.from({ length: 25 }, (_, i) => `word${i}`).join(" ");
  // Take the whole 25-word string — too long.
  assert.equal(validatePhrase(body, { offset: 0, length: body.length }), null);
});

test("validatePhrase rejects substrings containing a line break", () => {
  const body = "the first half ends here\nand the second half starts here";
  const phrase = "first half ends here\nand the second";
  const offset = body.indexOf(phrase);
  assert.equal(validatePhrase(body, { offset, length: phrase.length }), null);
});

test("validatePhrase rejects phrases with leading or trailing whitespace", () => {
  const body = "the barber gave me a hundred bucks";
  // Length includes a trailing space → trimmable, so rejected.
  const trailingSpaceLen = "the barber gave me a hundred ".length;
  assert.equal(validatePhrase(body, { offset: 0, length: trailingSpaceLen }), null);
});

test("validatePhrase accepts a phrase that starts after punctuation", () => {
  const body = "first thought. the barber gave me a hundred bucks today.";
  const phrase = "the barber gave me a hundred bucks today";
  const offset = body.indexOf(phrase);
  assert.deepEqual(
    validatePhrase(body, { offset, length: phrase.length }),
    { offset, length: phrase.length },
  );
});

test("parseClassifierJson tolerates code-fence wrapping", () => {
  assert.deepEqual(
    parseClassifierJson('```json\n{"deckHeading":"The Problem","phrase":null}\n```'),
    { deckHeading: "The Problem", phrase: null },
  );
  assert.deepEqual(
    parseClassifierJson('{"deckHeading": null, "phrase": null}'),
    { deckHeading: null, phrase: null },
  );
});

test("parseClassifierJson returns null on unparseable text", () => {
  assert.equal(parseClassifierJson("hello world"), null);
  assert.equal(parseClassifierJson(""), null);
});
