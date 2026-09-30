"use strict";

const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const libDir = path.resolve(__dirname, "..", "api", "_lib");
const anthropicPath = path.join(libDir, "anthropic.js");

let anthropicImpl = async () => {
  throw Object.assign(new Error("ANTHROPIC_API_KEY is not set."), { status: 503 });
};

function stubAnthropic() {
  const mod = new Module(anthropicPath);
  mod.filename = anthropicPath;
  mod.loaded = true;
  mod.exports = {
    callAnthropic: (...args) => anthropicImpl(...args),
  };
  require.cache[anthropicPath] = mod;
}

function loadPreread() {
  delete require.cache[require.resolve("../api/_lib/reading-preread.js")];
  stubAnthropic();
  return require("../api/_lib/reading-preread.js");
}

const prevKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
  anthropicImpl = async () => {
    throw Object.assign(new Error("ANTHROPIC_API_KEY is not set."), { status: 503 });
  };
});

afterEach(() => {
  if (prevKey == null) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = prevKey;
  delete require.cache[require.resolve("../api/_lib/reading-preread.js")];
  delete require.cache[anthropicPath];
});

test("fallback template is only for model failure", () => {
  const preread = loadPreread();
  const q = preread.fallbackQuestion("Domain-Driven Design", "Chapter 1: Crunching Knowledge");
  assert.match(q, preread.FALLBACK_TEMPLATE_RE);
  assert.equal(preread.isFallbackQuestion(q), true);
  assert.equal(
    preread.isFallbackQuestion(
      "Where in Tinker do you and the code use different words for the same thing?"
    ),
    false
  );
});

test("buildUser includes book, section theme, and earlier notes", () => {
  const preread = loadPreread();
  const user = preread.buildUser({
    bookTitle: "Domain-Driven Design",
    author: "Eric Evans",
    sectionTitle: "Part I — Chapter 1: Crunching Knowledge",
    priorSections: [],
    priorNotes: "### Prep?\nWe say lead and person for the same row.\n",
    asked: [],
  });
  assert.match(user, /Domain-Driven Design/);
  assert.match(user, /Crunching Knowledge/);
  assert.match(user, /Section theme/);
  assert.match(user, /lead and person/);
  assert.match(user, /Not a generic notice/i);
  assert.match(preread.sectionTheme("Chapter 14: Maintaining Model Integrity (Bounded Contexts)"), /Bounded Contexts|Maintaining Model Integrity/);
});

test("model success returns specific question, not the template", async () => {
  const specific =
    "Where in Tinker do you and the code already use different words for the same thing — before you open Crunching Knowledge?";
  anthropicImpl = async ({ system, messages, model }) => {
    assert.equal(model, "claude-opus-4-8");
    assert.match(system, /Do NOT use a generic template/i);
    assert.match(messages[0].content, /Crunching Knowledge/);
    assert.match(messages[0].content, /lead and person/);
    return {
      text: JSON.stringify({ next_question: specific, done: false }),
      usage: {},
    };
  };
  const preread = loadPreread();
  const detailed = await preread.generatePreReadQuestionDetailed({
    bookTitle: "Domain-Driven Design",
    author: "Eric Evans",
    sectionTitle: "Part I — Chapter 1: Crunching Knowledge",
    priorNotes: "### Prep?\nWe say lead and person for the same row.\n",
  });
  assert.equal(detailed.source, "model");
  assert.equal(detailed.question, specific);
  assert.equal(preread.isFallbackQuestion(detailed.question), false);
});

test("model failure falls back to the template only", async () => {
  anthropicImpl = async () => {
    throw Object.assign(new Error("Anthropic 502"), { status: 502 });
  };
  const preread = loadPreread();
  const detailed = await preread.generatePreReadQuestionDetailed({
    bookTitle: "Domain-Driven Design",
    sectionTitle: "Chapter 1: Crunching Knowledge",
  });
  assert.equal(detailed.source, "fallback");
  assert.equal(preread.isFallbackQuestion(detailed.question), true);
  assert.match(detailed.question, /Crunching Knowledge/);
  assert.match(detailed.question, /what do you want to notice or get clearer on/i);
});

test("missing API key falls back without calling Anthropic", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  let called = 0;
  anthropicImpl = async () => {
    called += 1;
    throw new Error("should not call");
  };
  const preread = loadPreread();
  const detailed = await preread.generatePreReadQuestionDetailed({
    bookTitle: "Example Book",
    sectionTitle: "Section One",
  });
  assert.equal(called, 0);
  assert.equal(detailed.source, "fallback");
  assert.equal(preread.isFallbackQuestion(detailed.question), true);
});
