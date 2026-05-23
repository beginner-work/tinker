/* Unit tests for /api/alt-pitches.
 *
 * The endpoint itself calls Anthropic, which we don't exercise here.
 * The pure helpers — title and heading validation, input
 * normalisation, the reconcile pass that enforces "every input id
 * lands in exactly one bucket plus a real deck heading + verbatim
 * phrase or both null", and the phrase resolver — are the contract
 * the route holds the model to. Anything the model returns has to
 * clear these checks or get dropped.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test__ } = require("../api/alt-pitches/index.js");
const {
  DECK_HEADINGS,
  HEADING_DESCRIPTIONS,
  MAX_WRITINGS,
  MAX_BUCKETS,
  validateTitle,
  validateHeading,
  reconcileClusters,
  parseClassifierJson,
  normalizeInputs,
  resolvePhraseText,
  fallbackPhrase,
  fallbackHeading,
  buildClusterPrompt,
  buildNamePrompt,
} = __test__;

test("DECK_HEADINGS matches the eleven literals", () => {
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

test("every heading has a non-trivial generic description", () => {
  for (const h of DECK_HEADINGS) {
    const d = HEADING_DESCRIPTIONS[h];
    assert.ok(d, `${h} missing description`);
    assert.ok(d.length > 20, `${h} description too short`);
  }
});

test("validateTitle accepts a single word of any casing, 1-14 letters", () => {
  assert.equal(validateTitle("Craft"), "Craft");
  assert.equal(validateTitle("tinker"), "tinker"); // lowercase preserved
  assert.equal(validateTitle("TINKER"), "TINKER"); // uppercase preserved
  assert.equal(validateTitle("Aaaaaaaaaaaaaa"), "Aaaaaaaaaaaaaa"); // 14
});

test("validateTitle rejects phrases, hyphens, empty values, oversized", () => {
  assert.equal(validateTitle("the craft"), null);
  assert.equal(validateTitle("Craft Money"), null);
  assert.equal(validateTitle("co-founder"), null);
  assert.equal(validateTitle("Aaaaaaaaaaaaaaa"), null); // 15 letters
  assert.equal(validateTitle(""), null);
  assert.equal(validateTitle(null), null);
  assert.equal(validateTitle(123), null);
});

test("validateHeading enforces the eleven literals + null", () => {
  for (const h of DECK_HEADINGS) {
    assert.equal(validateHeading(h), h);
  }
  assert.equal(validateHeading(null), null);
  assert.equal(validateHeading(undefined), null);
  assert.equal(validateHeading("the problem"), null);
  assert.equal(validateHeading("Problem"), null);
  assert.equal(validateHeading(""), null);
});

test("reconcileClusters validates titles, headings, and resolves phrases", () => {
  const inputs = [
    { id: "e_1", snippet: "the problem with coffee is the price" },
    { id: "e_2", snippet: "I am a barista who burned out" },
  ];
  const parsed = {
    pitches: [
      {
        title: "Coffee",
        writings: [
          { id: "e_1", deckHeading: "The Problem", phraseText: "the problem with coffee is the price" },
          { id: "e_2", deckHeading: "A Persona", phraseText: "I am a barista who burned out" },
        ],
      },
    ],
  };
  const out = reconcileClusters(parsed, inputs);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Coffee");
  assert.equal(out[0].writings.length, 2);
  assert.equal(out[0].writings[0].deckHeading, "The Problem");
  assert.equal(out[0].writings[0].phrase.writingId, "e_1");
  assert.ok(out[0].writings[0].phrase.length > 0);
  assert.equal(out[0].writings[1].deckHeading, "A Persona");
});

test("reconcileClusters falls back to a heading + phrase when the model returns an invalid heading", () => {
  const inputs = [{ id: "e_1", snippet: "I went to the cafe and ordered coffee" }];
  const parsed = {
    pitches: [
      {
        title: "Daily",
        writings: [
          { id: "e_1", deckHeading: "Random", phraseText: "I went to the cafe and ordered coffee" },
        ],
      },
    ],
  };
  const out = reconcileClusters(parsed, inputs);
  assert.equal(out.length, 1);
  // Invalid heading → falls back to a real one (round-robin from index 0 → "The Problem")
  assert.ok(DECK_HEADINGS.includes(out[0].writings[0].deckHeading));
  // Phrase falls back to first words of body — must be non-null
  assert.ok(out[0].writings[0].phrase);
  assert.ok(out[0].writings[0].phrase.length > 0);
});

test("reconcileClusters falls back to leading-words phrase when the model phrase isn't verbatim", () => {
  const inputs = [{ id: "e_1", snippet: "the cat sat on the mat in the morning" }];
  const parsed = {
    pitches: [
      {
        title: "Story",
        writings: [
          { id: "e_1", deckHeading: "The Problem", phraseText: "this phrase doesn't appear in the body" },
        ],
      },
    ],
  };
  const out = reconcileClusters(parsed, inputs);
  assert.equal(out.length, 1);
  assert.equal(out[0].writings[0].deckHeading, "The Problem");
  // Fallback phrase = leading words of the body
  assert.ok(out[0].writings[0].phrase);
  assert.equal(out[0].writings[0].phrase.writingId, "e_1");
});

test("reconcileClusters dedupes ids across buckets — first bucket wins", () => {
  const inputs = [
    { id: "a", snippet: "alpha alpha alpha sentence one here" },
    { id: "b", snippet: "beta beta beta sentence two here" },
    { id: "c", snippet: "gamma gamma gamma sentence three here" },
  ];
  const parsed = {
    pitches: [
      { title: "First", writings: [{ id: "a", deckHeading: "The Problem", phraseText: "alpha alpha alpha sentence one here" }, { id: "b", deckHeading: "A Persona", phraseText: "beta beta beta sentence two here" }] },
      { title: "Second", writings: [{ id: "b", deckHeading: "The Problem", phraseText: "beta beta beta sentence two here" }, { id: "c", deckHeading: "The Vision", phraseText: "gamma gamma gamma sentence three here" }] },
    ],
  };
  const out = reconcileClusters(parsed, inputs);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].writings.map((w) => w.id), ["a", "b"]);
  assert.deepEqual(out[1].writings.map((w) => w.id), ["c"]);
});

test("reconcileClusters sweeps leftover ids (with synthesized slots) into the first valid bucket", () => {
  const inputs = [
    { id: "a", snippet: "alpha sentence one with several words here" },
    { id: "b", snippet: "beta sentence two with several words here" },
    { id: "c", snippet: "gamma sentence three with several words here" },
    { id: "d", snippet: "delta sentence four with several words here" },
  ];
  const parsed = {
    pitches: [
      { title: "Known", writings: [{ id: "a", deckHeading: "The Problem", phraseText: "alpha sentence one with several words here" }] },
      { title: "Other", writings: [{ id: "b", deckHeading: "A Persona", phraseText: "beta sentence two with several words here" }] },
    ],
  };
  const out = reconcileClusters(parsed, inputs);
  assert.equal(out.length, 2);
  const firstIds = out[0].writings.map((w) => w.id).sort();
  assert.deepEqual(firstIds, ["a", "c", "d"]);
  // Synthesised slots must be real headings + non-null phrases.
  for (const w of out[0].writings) {
    assert.ok(DECK_HEADINGS.includes(w.deckHeading));
    assert.ok(w.phrase, `${w.id} should have a fallback phrase`);
  }
});

test("reconcileClusters falls back to a single 'Other' bucket when nothing validates", () => {
  const inputs = [
    { id: "a", snippet: "alpha sentence here with words" },
    { id: "b", snippet: "beta sentence here with words" },
  ];
  const parsed = {
    pitches: [
      { title: "lowercase phrase", writings: [{ id: "a", deckHeading: "The Problem", phraseText: "alpha sentence here with words" }] },
      { title: "Two Words", writings: [{ id: "b", deckHeading: "A Persona", phraseText: "beta sentence here with words" }] },
    ],
  };
  const out = reconcileClusters(parsed, inputs);
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "Other");
  assert.equal(out[0].writings.length, 2);
  // Even the orphan bucket guarantees slots.
  for (const w of out[0].writings) {
    assert.ok(DECK_HEADINGS.includes(w.deckHeading));
    assert.ok(w.phrase);
  }
});

test("reconcileClusters caps at MAX_BUCKETS", () => {
  const inputs = [];
  for (let i = 0; i < 8; i++) inputs.push({ id: `e_${i}`, snippet: `body ${i} with several words here for the test` });
  const parsed = {
    pitches: [
      { title: "One", writings: [{ id: "e_0", deckHeading: "The Problem", phraseText: "body 0 with several words here" }] },
      { title: "Two", writings: [{ id: "e_1", deckHeading: "A Persona", phraseText: "body 1 with several words here" }] },
      { title: "Three", writings: [{ id: "e_2", deckHeading: "Why Now?", phraseText: "body 2 with several words here" }] },
      { title: "Four", writings: [{ id: "e_3", deckHeading: "The Team", phraseText: "body 3 with several words here" }] },
      { title: "Five", writings: [{ id: "e_4", deckHeading: "The Product", phraseText: "body 4 with several words here" }] },
    ],
  };
  const out = reconcileClusters(parsed, inputs);
  assert.equal(out.length, MAX_BUCKETS);
  // Leftover ids (e_4 through e_7) sweep into the first bucket.
  const firstIds = out[0].writings.map((w) => w.id);
  assert.ok(firstIds.includes("e_4"));
  assert.ok(firstIds.includes("e_5"));
  assert.ok(firstIds.includes("e_6"));
  assert.ok(firstIds.includes("e_7"));
});

test("fallbackPhrase pulls leading words and resolves to a verbatim slice", () => {
  const body = "the brief intro line goes here and then keeps going further";
  const fp = fallbackPhrase(body);
  assert.ok(fp);
  const slice = body.slice(fp.offset, fp.offset + fp.length);
  assert.ok(slice.length > 0);
  // The slice is a contiguous prefix of the body.
  assert.equal(body.indexOf(slice), 0);
});

test("fallbackPhrase returns null on blank or whitespace-only bodies", () => {
  assert.equal(fallbackPhrase(""), null);
  assert.equal(fallbackPhrase("   \t\n  "), null);
});

test("fallbackHeading round-robins through the eleven literals", () => {
  for (let i = 0; i < 25; i++) {
    assert.equal(fallbackHeading(i), DECK_HEADINGS[i % DECK_HEADINGS.length]);
  }
});

test("every input writing appears in the reply (no orphans) — model leaves headings blank", () => {
  const inputs = [
    { id: "a", snippet: "alpha body content here today" },
    { id: "b", snippet: "beta body content here today" },
    { id: "c", snippet: "gamma body content here today" },
  ];
  // Model returns valid clusters but with null headings — fallbacks
  // must kick in and every writing must still appear.
  const parsed = {
    pitches: [
      { title: "Group", writings: [
        { id: "a", deckHeading: null, phraseText: null },
        { id: "b", deckHeading: null, phraseText: null },
        { id: "c", deckHeading: null, phraseText: null },
      ] },
    ],
  };
  const out = reconcileClusters(parsed, inputs);
  const seenIds = new Set();
  for (const p of out) {
    for (const w of p.writings) {
      seenIds.add(w.id);
      assert.ok(DECK_HEADINGS.includes(w.deckHeading), `${w.id} should have a real heading`);
      assert.ok(w.phrase, `${w.id} should have a non-null phrase`);
    }
  }
  assert.deepEqual(Array.from(seenIds).sort(), ["a", "b", "c"]);
});

test("normalizeInputs drops blank bodies, dedupes by id, truncates long snippets", () => {
  const longBody = "x".repeat(2000);
  const out = normalizeInputs([
    { id: "e_1", snippet: "hello" },
    { id: "e_1", snippet: "duplicate id, dropped" },
    { id: "e_2", snippet: "   " },
    { id: "e_3", snippet: longBody },
    { id: "", snippet: "missing id, dropped" },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].id, "e_1");
  assert.equal(out[1].id, "e_3");
  assert.ok(out[1].snippet.endsWith("…"));
});

test("normalizeInputs caps at MAX_WRITINGS", () => {
  const arr = [];
  for (let i = 0; i < MAX_WRITINGS + 10; i++) arr.push({ id: `e_${i}`, snippet: `body ${i}` });
  const out = normalizeInputs(arr);
  assert.equal(out.length, MAX_WRITINGS);
});

test("resolvePhraseText accepts a clean 3-22 word verbatim slice", () => {
  const body = "the barber gave me a hundred bucks and i didn't know what to say";
  const r = resolvePhraseText(body, "the barber gave me a hundred bucks");
  assert.ok(r);
  assert.equal(body.slice(r.offset, r.offset + r.length), "the barber gave me a hundred bucks");
});

test("resolvePhraseText rejects substrings that start mid-word", () => {
  const body = "the barber gave me a hundred bucks";
  // "arber" starts inside "barber" — must be rejected.
  assert.equal(resolvePhraseText(body, "arber gave me a hundred bucks"), null);
});

test("resolvePhraseText falls back to whitespace-normalised search", () => {
  const body = "the\nbarber  gave me\ta hundred bucks";
  const r = resolvePhraseText(body, "the barber gave me a hundred bucks");
  assert.ok(r);
});

test("parseClassifierJson strips code fences", () => {
  const fenced = "```json\n{\"pitches\":[]}\n```";
  assert.deepEqual(parseClassifierJson(fenced), { pitches: [] });
  assert.equal(parseClassifierJson("not json"), null);
});

test("buildClusterPrompt names every heading + lists existing titles", () => {
  const sys = buildClusterPrompt(["Tinker", "Coffee"]);
  for (const h of DECK_HEADINGS) {
    assert.ok(sys.includes(h), `missing heading: ${h}`);
  }
  assert.ok(sys.includes("EXACTLY ONE WORD"));
  assert.ok(sys.includes("3 to 14 letters"));
  assert.ok(sys.includes("Tinker"));
  assert.ok(sys.includes("Coffee"));
});

test("buildNamePrompt asks for one-word title JSON", () => {
  const sys = buildNamePrompt();
  assert.ok(sys.includes("EXACTLY ONE WORD"));
  assert.ok(sys.includes("3 to 14 letters"));
  assert.ok(sys.includes("\"title\""));
});
