/* Outreach subject helpers: answer-only, no pre-context. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const interview = require("../src/renderer/interview-prompt.js");

test("KEEP_CRAFTING_MODEL is a single switchable constant", () => {
  assert.equal(interview.KEEP_CRAFTING_MODEL, "claude-opus-4-8");
});

test("fallbackOutreachSubject uses typed answers only (no person/company filler)", () => {
  const answer = "I believe in your ability to build software";
  const a = interview.fallbackOutreachSubject([
    { q: "What do you want Louis Weis at Ramp to understand about you?", a: answer },
  ]);
  const b = interview.fallbackOutreachSubject([
    { q: "What do you want Louis Weis at Ramp to understand about you?", a: answer },
  ]);
  assert.equal(a, b);
  assert.equal(a, answer);
  assert.equal(/\b99\.9\b/.test(a), false);
  assert.equal(/\breliability\b/i.test(a), false);
  assert.equal(/\u2014/.test(a), false);
  assert.ok(a.length <= 90);
});

test("fallbackOutreachSubject ignores legacy person/company args", () => {
  // Old signature was (personName, companyName). Must not invent filler.
  const empty = interview.fallbackOutreachSubject("Louis Weis", "Ramp");
  assert.equal(empty, "Quick note");
});

test("normalizeOutreachSubject rejects empty, cleans Re:, and drops ungrounded numbers", () => {
  const turns = [{ q: "Q?", a: "I believe in your ability to build software" }];
  assert.equal(interview.normalizeOutreachSubject({ subject: "  " }, turns), null);
  assert.equal(
    interview.normalizeOutreachSubject({ subject: "Re: I believe in your ability" }, turns),
    "I believe in your ability",
  );
  assert.equal(
    interview.normalizeOutreachSubject(
      { subject: "Production reliability tech lead: brought a missed 99.9% target back" },
      turns,
    ),
    null,
  );
});

test("parseSubjectResponse accepts JSON and bare lines", () => {
  assert.equal(
    interview.parseSubjectResponse('{"subject":"Building with ownership"}').subject,
    "Building with ownership",
  );
  assert.equal(
    interview.parseSubjectResponse("```json\n{\"subject\":\"Hello Hamid\"}\n```").subject,
    "Hello Hamid",
  );
});

test("buildSubjectUserMessage is answer-only (no company/career/person pre-context)", () => {
  const answer = "I believe in your ability to build software";
  const msg = interview.buildSubjectUserMessage({
    personName: "Louis Weis",
    personTitle: "Lead Technical Recruiter",
    companyName: "Ramp",
    companyContext:
      "Ramp's production engineering team owns reliability across the whole company, which is the work you did bringing a missed 99.9% availability target back.",
    transcript: [
      { q: "What do you want Louis Weis at Ramp to understand about you?", a: answer },
    ],
  });
  assert.match(msg, /I believe in your ability to build software/);
  assert.equal(/Company context:/i.test(msg), false);
  assert.equal(/99\.9/.test(msg), false);
  assert.equal(/reliability/i.test(msg), false);
  assert.equal(/Louis Weis/.test(msg), false);
  assert.equal(/Ramp/.test(msg), false);
  assert.equal(/Prep context:/i.test(msg), false);
  assert.equal(/\bTyler\b/.test(msg), false);
});

test("stitchOutreachBody joins typed answers only", () => {
  const body = interview.stitchOutreachBody([
    { q: "Q1", a: "I believe in your ability to build software" },
    { q: "Q2", a: "  " },
    { q: "Q3", a: "And I stay close to the work." },
  ]);
  assert.equal(body, "I believe in your ability to build software\n\nAnd I stay close to the work.");
});

test("outreachTextGrounded rejects numbers that are not in the answers", () => {
  const turns = [{ q: "Q?", a: "I believe in your ability to build software" }];
  assert.equal(
    interview.outreachTextGrounded("I believe in your ability to build software", turns),
    true,
  );
  assert.equal(
    interview.outreachTextGrounded("Production reliability tech lead: brought a missed 99.9% target back", turns),
    false,
  );
  assert.equal(
    interview.outreachTextGrounded("Shipped 3 things this week", [{ q: "Q?", a: "Shipped 3 things this week" }]),
    true,
  );
});

test("SUBJECT_SYSTEM_PROMPT forbids pre-context and invented numbers", () => {
  assert.match(interview.SUBJECT_SYSTEM_PROMPT, /ONLY the founder's typed answers/i);
  assert.match(interview.SUBJECT_SYSTEM_PROMPT, /Do not invent facts, numbers/i);
  assert.match(interview.SUBJECT_SYSTEM_PROMPT, /Never use an em dash/i);
});
