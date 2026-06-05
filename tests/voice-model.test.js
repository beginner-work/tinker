/* Unit tests for /api/voice/model.
 *
 * The endpoint itself reads the founder's essays from Postgres and calls
 * Anthropic to analyse their writing voice — neither is exercised here.
 * What we pin down are the pure helpers the route is built on: how the
 * essay corpus is assembled and signed (the cache key that decides whether
 * a retrain happens), and how the analyser's JSON is parsed and clamped
 * into a known-shape profile. Anything the model returns has to clear
 * parseVoiceProfile or get dropped.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test__ } = require("../api/voice/model.js");
const {
  MIN_WORDS,
  MAX_CORPUS_CHARS,
  essayText,
  buildCorpus,
  corpusSignature,
  corpusWordCount,
  clampCorpus,
  buildAnalysisMessage,
  parseVoiceProfile,
} = __test__;

test("essayText joins title and body, trims, tolerates partials", () => {
  assert.equal(essayText({ title: "Hi", body: "there" }), "Hi\nthere");
  assert.equal(essayText({ body: "  only body  " }), "only body");
  assert.equal(essayText({ title: "only title" }), "only title");
  assert.equal(essayText({}), "");
  assert.equal(essayText(null), "");
  assert.equal(essayText("nope"), "");
});

test("buildCorpus drops archived and empty essays, preserves order", () => {
  const essays = [
    { title: "A", body: "first" },
    { title: "B", body: "second", archived: true },
    { body: "" },
    { title: "C", body: "third" },
  ];
  assert.deepEqual(buildCorpus(essays), ["A\nfirst", "C\nthird"]);
  assert.deepEqual(buildCorpus(null), []);
  assert.deepEqual(buildCorpus("nope"), []);
});

test("corpusSignature is stable and changes when content changes", () => {
  const a = ["one two", "three"];
  assert.equal(corpusSignature(a), corpusSignature(["one two", "three"]));
  assert.notEqual(corpusSignature(a), corpusSignature(["one two", "three four"]));
  // Adding an essay changes the count component → different signature.
  assert.notEqual(corpusSignature(a), corpusSignature(["one two", "three", ""]));
  assert.equal(corpusSignature([]), "0:0:" + (5381).toString(36));
});

test("corpusWordCount counts across pieces, ignoring whitespace runs", () => {
  assert.equal(corpusWordCount(["one two", "three"]), 3);
  assert.equal(corpusWordCount(["  spaced   out  ", "\n\nthird"]), 3);
  assert.equal(corpusWordCount([]), 0);
});

test("clampCorpus keeps whole pieces under the char budget", () => {
  const big = "x".repeat(MAX_CORPUS_CHARS - 10);
  const second = "y".repeat(100);
  const kept = clampCorpus([big, second]);
  // First piece fits; second would overflow, so it's dropped (first stays whole).
  assert.deepEqual(kept, [big]);
});

test("clampCorpus always keeps at least the first piece even if oversized", () => {
  const huge = "z".repeat(MAX_CORPUS_CHARS + 5000);
  const kept = clampCorpus([huge, "tail"]);
  assert.deepEqual(kept, [huge]);
});

test("buildAnalysisMessage lists pieces separated by ---", () => {
  const msg = buildAnalysisMessage(["alpha", "beta"]);
  assert.match(msg, /alpha/);
  assert.match(msg, /beta/);
  assert.match(msg, /---/);
});

test("parseVoiceProfile parses, clamps, and shapes a profile", () => {
  const raw = JSON.stringify({
    voiceCard: "Writes in short, dry declaratives.",
    tone: "dry",
    cadence: "clipped",
    vocabulary: ["honestly", "the thing is", 42, ""],
    sentenceRhythm: "short then long",
    signatureMoves: ["asides in dashes", "lists of three"],
    avoids: ["exclamation marks"],
    excerpts: ["The thing is, I kept going.", "No fanfare. Just the work.", 7, ""],
    interviewerStyle: "Ask plainly, no warm-up.",
    extra: "ignored",
  });
  const p = parseVoiceProfile(raw);
  assert.equal(p.voiceCard, "Writes in short, dry declaratives.");
  assert.equal(p.tone, "dry");
  // Non-string vocabulary entries and empties are dropped.
  assert.deepEqual(p.vocabulary, ["honestly", "the thing is"]);
  assert.deepEqual(p.signatureMoves, ["asides in dashes", "lists of three"]);
  // Verbatim excerpts are kept in order; non-strings and empties dropped.
  assert.deepEqual(p.excerpts, ["The thing is, I kept going.", "No fanfare. Just the work."]);
  assert.equal(p.interviewerStyle, "Ask plainly, no warm-up.");
  assert.equal("extra" in p, false);
});

test("parseVoiceProfile caps excerpts at four", () => {
  const raw = JSON.stringify({
    voiceCard: "x",
    excerpts: ["one", "two", "three", "four", "five", "six"],
  });
  const p = parseVoiceProfile(raw);
  assert.deepEqual(p.excerpts, ["one", "two", "three", "four"]);
});

test("parseVoiceProfile tolerates code fences", () => {
  const raw = "```json\n{\"voiceCard\":\"x\"}\n```";
  const p = parseVoiceProfile(raw);
  assert.ok(p);
  assert.equal(p.voiceCard, "x");
});

test("parseVoiceProfile rejects junk and empty profiles", () => {
  assert.equal(parseVoiceProfile("not json"), null);
  assert.equal(parseVoiceProfile(""), null);
  assert.equal(parseVoiceProfile("[1,2,3]"), null);
  // Object with no voiceCard and no interviewerStyle is unusable.
  assert.equal(parseVoiceProfile(JSON.stringify({ tone: "dry" })), null);
});

test("MIN_WORDS gate is a sane positive threshold", () => {
  assert.ok(MIN_WORDS > 0 && MIN_WORDS < 1000);
});
