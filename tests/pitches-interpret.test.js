/* Unit tests for /api/pitches/interpret's pure helpers.
 *
 * The endpoint reflects back how the model reads a pitch the founder
 * assembled — it never rewrites. These tests cover the slide resolver
 * (which decides exactly what material the model sees) and the prompt
 * builders. The Anthropic call itself isn't exercised.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test__ } = require("../api/pitches/interpret.js");
const {
  resolveSlides,
  buildInterpretPrompt,
  buildInterpretUserMessage,
} = __test__;

const ESSAY_BODY = "the barber gave me a hundred bucks and i didn't know what to say about it";

function blobWith(deck, extra) {
  return {
    pitches: [{
      id: "p_1",
      aiTitle: "Coffee",
      personalTitle: (extra && extra.personalTitle) || null,
      aiTitleSourceHash: null,
      deck,
      meta: {},
      createdAt: 1,
    }],
    activeId: "p_1",
  };
}

test("resolveSlides returns the verbatim phrase, the essay's title, and an excerpt", () => {
  const blob = blobWith({
    "The Problem": [{ writingId: "e_1", offset: 0, length: "the barber gave me a hundred bucks".length, addedAt: 1 }],
  });
  const essays = [{ id: "e_1", title: "Fundraising", body: ESSAY_BODY }];
  const resolved = resolveSlides(blob, "p_1", essays, []);
  assert.ok(resolved);
  assert.equal(resolved.title, "Coffee");
  assert.equal(resolved.slides.length, 1);
  const slide = resolved.slides[0];
  assert.equal(slide.heading, "The Problem");
  assert.equal(slide.phrase, "the barber gave me a hundred bucks");
  assert.equal(slide.title, "Fundraising");
  assert.ok(slide.excerpt.startsWith("the barber gave me"));
  // Every other heading is reported as uncovered.
  assert.equal(resolved.uncovered.length, 10);
  assert.ok(resolved.uncovered.includes("The Ask"));
});

test("resolveSlides skips records whose offsets no longer land in the body", () => {
  const blob = blobWith({
    "The Problem": [{ writingId: "e_1", offset: 5000, length: 20, addedAt: 1 }],
  });
  const essays = [{ id: "e_1", title: "", body: ESSAY_BODY }];
  const resolved = resolveSlides(blob, "p_1", essays, []);
  assert.equal(resolved.slides.length, 0);
  assert.equal(resolved.uncovered.length, 11);
});

test("resolveSlides returns null for an unknown pitch", () => {
  const blob = blobWith({});
  assert.equal(resolveSlides(blob, "p_missing", [], []), null);
});

test("resolveSlides prefers the founder's personal title for the pitch", () => {
  const blob = blobWith(
    { "The Problem": [{ writingId: "e_1", offset: 0, length: 10, addedAt: 1 }] },
    { personalTitle: "my coffee thing" },
  );
  const essays = [{ id: "e_1", title: "", body: ESSAY_BODY }];
  const resolved = resolveSlides(blob, "p_1", essays, []);
  assert.equal(resolved.title, "my coffee thing");
});

test("the interpret prompt is a mirror, not an editor", () => {
  const sys = buildInterpretPrompt();
  assert.ok(sys.includes("reflect back"), "prompt asks for a read-back");
  assert.ok(/never rewrite/i.test(sys), "prompt forbids rewriting");
  assert.ok(/no scores, no advice/i.test(sys), "prompt forbids coaching");
});

test("the user message carries slides, essay titles, quotes, and empty slides", () => {
  const msg = buildInterpretUserMessage({
    title: "Coffee",
    slides: [{
      heading: "The Problem",
      title: "Fundraising",
      phrase: "the barber gave me a hundred bucks",
      excerpt: ESSAY_BODY,
    }],
    uncovered: ["The Ask", "Competition"],
  });
  assert.ok(msg.includes("Pitch title: Coffee"));
  assert.ok(msg.includes("Slide: The Problem"));
  assert.ok(msg.includes("Essay title: Fundraising"));
  assert.ok(msg.includes('"the barber gave me a hundred bucks"'));
  assert.ok(msg.includes("Slides with nothing on them yet: The Ask, Competition"));
});
