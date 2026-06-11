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
  resolvePhraseText,
  validateHeading,
  parseClassifierJson,
  buildSystemPrompt,
} = __test__;

test("the eleven deck headings are spelled exactly as in pitch-deck.md", () => {
  assert.deepEqual(DECK_HEADINGS, [
    "The Problem",
    "A Persona",
    "Why Now?",
    "The Team",
    "The Product",
    "How We Make Money",
    "Go to Market",
    "The Moat",
    "The Vision",
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

test("validatePhrase rejects fewer than 3 words", () => {
  const body = "the barber gave me a hundred bucks";
  const phrase = "the barber";
  const offset = body.indexOf(phrase);
  assert.equal(validatePhrase(body, { offset, length: phrase.length }), null);
});

test("validatePhrase accepts a 3-word phrase (relaxed from 4)", () => {
  const body = "first sentence here. everyone is here today. another sentence.";
  const phrase = "everyone is here";
  const offset = body.indexOf(phrase);
  assert.deepEqual(
    validatePhrase(body, { offset, length: phrase.length }),
    { offset, length: phrase.length },
  );
});

test("validatePhrase rejects more than 22 words", () => {
  const body = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
  // Take the whole 30-word string — too long.
  assert.equal(validatePhrase(body, { offset: 0, length: body.length }), null);
});

test("validatePhrase trims tolerable leading/trailing whitespace from the model", () => {
  const body = "before the barber gave me a hundred bucks today after";
  const trimmedPhrase = "the barber gave me a hundred bucks today";
  const trimmedOffset = body.indexOf(trimmedPhrase);
  // Model sent a slice with a leading space (offset one back, length +1).
  const result = validatePhrase(body, {
    offset: trimmedOffset - 1,
    length: trimmedPhrase.length + 1,
  });
  assert.deepEqual(result, { offset: trimmedOffset, length: trimmedPhrase.length });
});

test("validatePhrase rejects substrings containing a line break", () => {
  const body = "the first half ends here\nand the second half starts here";
  const phrase = "first half ends here\nand the second";
  const offset = body.indexOf(phrase);
  assert.equal(validatePhrase(body, { offset, length: phrase.length }), null);
});

test("validatePhrase trims trailing whitespace from a model slice", () => {
  const body = "the barber gave me a hundred bucks";
  const trailingSpaceLen = "the barber gave me a hundred ".length;
  // The trailing space is folded out; the returned window is the
  // trimmed phrase, which is 6 words long and clears the word-count
  // floor.
  assert.deepEqual(
    validatePhrase(body, { offset: 0, length: trailingSpaceLen }),
    { offset: 0, length: "the barber gave me a hundred".length },
  );
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

test("resolvePhraseText finds an exact substring in the body", () => {
  const body = "the barber gave me a hundred bucks and i didn't know what to say";
  const phrase = "the barber gave me a hundred bucks";
  assert.deepEqual(
    resolvePhraseText(body, phrase),
    { offset: 0, length: phrase.length },
  );
});

test("resolvePhraseText handles whitespace-normalized mismatches", () => {
  // Body has a newline mid-sentence; model returned the phrase
  // with the newline collapsed to a space.
  const body = "the barber gave me\na hundred bucks today";
  const phrase = "the barber gave me a hundred bucks today";
  const r = resolvePhraseText(body, phrase);
  // Resolved range should map back to the original body span.
  assert.ok(r);
  assert.equal(r.offset, 0);
  assert.equal(body.slice(r.offset, r.offset + r.length), body);
});

test("resolvePhraseText returns null when the phrase isn't in the body", () => {
  const body = "the barber gave me a hundred bucks";
  assert.equal(resolvePhraseText(body, "I went to the moon yesterday"), null);
});

test("resolvePhraseText rejects fewer than 3 words", () => {
  const body = "the barber gave me a hundred bucks";
  assert.equal(resolvePhraseText(body, "the barber"), null);
});

test("resolvePhraseText accepts a 3-word phrase", () => {
  const body = "everyone is here today, finally, after all these months of waiting around";
  assert.deepEqual(
    resolvePhraseText(body, "everyone is here"),
    { offset: 0, length: "everyone is here".length },
  );
});

test("resolvePhraseText trims a stray leading/trailing space from the model", () => {
  const body = "the barber gave me a hundred bucks today";
  const r = resolvePhraseText(body, "  the barber gave me a hundred  ");
  assert.deepEqual(r, { offset: 0, length: "the barber gave me a hundred".length });
});

test("system prompt routes explicit topics — a fundraising essay belongs in The Ask", () => {
  const sys = buildSystemPrompt();
  assert.ok(sys.includes("EXPLICIT TOPIC WINS"), "explicit-topic rule present");
  assert.ok(sys.includes("fundraising"), "rule names fundraising");
  assert.ok(sys.includes("strongest signal"), "title called out as the strongest signal");
});

test("buildUserContent puts the founder's title above the body, when there is one", () => {
  const { buildUserContent } = __test__;
  const body = "the barber gave me a hundred bucks";
  assert.equal(buildUserContent(body, ""), body);
  assert.equal(buildUserContent(body, null), body);
  const withTitle = buildUserContent(body, "  Fundraising  ");
  assert.ok(withTitle.startsWith("title: Fundraising\n"));
  assert.ok(withTitle.endsWith(body), "body is intact so phrase offsets still resolve");
});
