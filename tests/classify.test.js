/* Unit tests for the slide-category tagger's pure helpers.
 *
 * /api/classify tags one writing with the category it fits — once, at
 * publish time. The endpoint itself calls Anthropic, which we don't
 * exercise here; the prompt builder and validators are the contract
 * the tagger enforces against the model.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test__ } = require("../api/classify/index.js");
const {
  SLIDE_CATEGORIES,
  CATEGORY_DESCRIPTIONS,
  EXPLICIT_TOPIC_RULE,
  buildSystemPrompt,
  buildUserContent,
  validateSlide,
  parseReply,
} = __test__;

test("the eleven slide categories are spelled exactly", () => {
  assert.deepEqual(SLIDE_CATEGORIES, [
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

test("each category has a description and the prompt quotes them all", () => {
  const sys = buildSystemPrompt();
  for (const c of SLIDE_CATEGORIES) {
    const d = CATEGORY_DESCRIPTIONS[c];
    assert.ok(d && d.length > 20, `${c} missing description`);
    assert.ok(sys.includes(`- ${c}`), `prompt missing category: ${c}`);
  }
});

test("explicit topics win — a fundraising essay belongs to The Ask", () => {
  const sys = buildSystemPrompt();
  assert.ok(sys.includes(EXPLICIT_TOPIC_RULE));
  assert.ok(EXPLICIT_TOPIC_RULE.includes("fundraising"));
  assert.ok(EXPLICIT_TOPIC_RULE.includes("The Ask"));
  assert.ok(EXPLICIT_TOPIC_RULE.includes("strongest signal"), "the founder's title is the strongest signal");
});

test("buildUserContent puts the founder's title above the body when present", () => {
  const body = "the barber gave me a hundred bucks";
  assert.equal(buildUserContent(body, ""), body);
  assert.equal(buildUserContent(body, null), body);
  const withTitle = buildUserContent(body, "  Fundraising  ");
  assert.ok(withTitle.startsWith("title: Fundraising\n"));
  assert.ok(withTitle.endsWith(body));
});

test("validateSlide accepts exact literals, allows null, rejects paraphrases", () => {
  assert.equal(validateSlide("The Ask"), "The Ask");
  assert.equal(validateSlide("Why Now?"), "Why Now?");
  assert.equal(validateSlide(null), null);
  assert.equal(validateSlide("the ask"), undefined);
  assert.equal(validateSlide("Ask"), undefined);
  assert.equal(validateSlide(""), undefined);
  assert.equal(validateSlide(undefined), undefined);
});

test("parseReply tolerates code fences and returns null on garbage", () => {
  assert.deepEqual(parseReply('```json\n{"slide":"The Ask"}\n```'), { slide: "The Ask" });
  assert.deepEqual(parseReply('{"slide": null}'), { slide: null });
  assert.equal(parseReply("hello world"), null);
  assert.equal(parseReply(""), null);
});
