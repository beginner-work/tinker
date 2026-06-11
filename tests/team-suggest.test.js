/* Unit tests for /api/team/suggest's pure helpers.
 *
 * "Invite others onto your team": suggests people who might be
 * answering a question the founder leaves unanswered in their essays,
 * matched on what those people write in theirs. The privacy contract
 * is the point of these tests: the validated output can carry ONLY the
 * founder's own questions plus a user id — never a candidate's words,
 * even if the model tries.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { __test__ } = require("../api/team/suggest.js");
const {
  MAX_QUESTIONS,
  extractQuestions,
  candidateText,
  buildSystemPrompt,
  buildUserMessage,
  validateMatches,
  parseReply,
} = __test__;

test("extractQuestions plucks my literal question-sentences, newest essay first, verbatim", () => {
  const essays = [
    { id: "e_old", createdAt: 1000, body: "Where do founders even meet each other? Some statement." },
    { id: "e_new", createdAt: 2000, body: "I keep wondering. Who would actually pay for tinker?" },
  ];
  const qs = extractQuestions(essays);
  assert.deepEqual(qs, [
    "Who would actually pay for tinker?",
    "Where do founders even meet each other?",
  ], "newest essay's questions first, exact text");
});

test("extractQuestions dedupes case/whitespace-insensitively and skips short ones", () => {
  const essays = [
    { id: "e1", createdAt: 2000, body: "Who would actually pay for tinker? Why?" },
    { id: "e2", createdAt: 1000, body: "who would ACTUALLY   pay for tinker?" },
  ];
  const qs = extractQuestions(essays);
  assert.deepEqual(qs, ["Who would actually pay for tinker?"], "duplicate dropped, 'Why?' too short");
});

test("extractQuestions skips archived essays and caps the list", () => {
  const essays = [
    { id: "e_arch", createdAt: 9000, archived: true, body: "Should this be hidden from matching?" },
    {
      id: "e1",
      createdAt: 1000,
      body: "Question number one, okay? Question number two, okay? Question number three, okay? Question number four, okay? Question number five, okay? Question number six, okay?",
    },
  ];
  const qs = extractQuestions(essays);
  assert.equal(qs.length, MAX_QUESTIONS);
  assert.ok(!qs.some((q) => q.includes("hidden from matching")), "archived essays don't participate");
});

test("candidateText joins newest-first bodies and skips archived", () => {
  const text = candidateText([
    { id: "a", createdAt: 1000, body: "older words" },
    { id: "b", createdAt: 2000, body: "newer words" },
    { id: "c", createdAt: 3000, archived: true, body: "archived words" },
  ]);
  assert.equal(text, "newer words\n\nolder words");
});

test("validateMatches lets through only my own questions paired with known candidates", () => {
  const questions = ["Who would actually pay for tinker?"];
  const candidates = [
    { code: "A", userId: "user-aaa", text: "I pay for tools like this every week." },
    { code: "B", userId: "user-bbb", text: "Unrelated." },
  ];
  const out = validateMatches(
    {
      matches: [
        { candidate: "A", question: "Who would actually pay for tinker?", reason: "They've been deciding what tools deserve money." },
        // The model paraphrased my question — dropped.
        { candidate: "B", question: "Who pays for tinker?" },
        // Unknown candidate — dropped.
        { candidate: "Z", question: "Who would actually pay for tinker?" },
        // Duplicate candidate — dropped.
        { candidate: "A", question: "Who would actually pay for tinker?" },
      ],
    },
    questions,
    candidates,
  );
  assert.deepEqual(out, [{
    userId: "user-aaa",
    question: "Who would actually pay for tinker?",
    reason: "They've been deciding what tools deserve money.",
  }]);
});

test("privacy contract: a candidate's words can't ride out through any field", () => {
  const questions = ["Who would actually pay for tinker?"];
  const candidates = [
    { code: "A", userId: "user-aaa", text: "My secret revenue is $9,000 a month." },
  ];
  // Leak attempt via the question field — must be an exact copy of MY
  // question, so it's dropped.
  const out = validateMatches(
    { matches: [{ candidate: "A", question: "My secret revenue is $9,000 a month." }] },
    questions,
    candidates,
  );
  assert.deepEqual(out, []);
  // Leak attempt via the reason field — a reason that is a verbatim
  // run of the candidate's text is a quote, not a description: emptied.
  const quoted = validateMatches(
    { matches: [{ candidate: "A", question: questions[0], reason: "My secret revenue is $9,000 a month." }] },
    questions,
    candidates,
  );
  assert.equal(quoted[0].reason, "");
  // A described-at-arm's-length reason passes; extra fields are shed.
  const good = validateMatches(
    { matches: [{ candidate: "A", question: questions[0], reason: "They think about paying for tools.", answer: "smuggled" }] },
    questions,
    candidates,
  );
  assert.deepEqual(Object.keys(good[0]).sort(), ["question", "reason", "userId"]);
  assert.equal(good[0].reason, "They think about paying for tools.");
});

test("the prompt forbids quoting candidates and the user message carries both sides", () => {
  const sys = buildSystemPrompt();
  assert.ok(sys.includes("never quote, excerpt, or closely paraphrase a candidate's sentences"));
  assert.ok(sys.includes("reason"), "the matcher explains why in its own words");
  const msg = buildUserMessage(
    ["Who would actually pay for tinker?"],
    [{ code: "A", userId: "u", text: "candidate words" }],
  );
  assert.ok(msg.includes("MY QUESTIONS:"));
  assert.ok(msg.includes("- Who would actually pay for tinker?"));
  assert.ok(msg.includes("[A]"));
  assert.ok(msg.includes("candidate words"));
});

test("parseReply tolerates code fences and garbage", () => {
  assert.deepEqual(parseReply('```json\n{"matches":[]}\n```'), { matches: [] });
  assert.equal(parseReply("nope"), null);
});
