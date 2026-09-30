/* Outreach subject helpers for This is everything. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const interview = require("../src/renderer/interview-prompt.js");

test("KEEP_CRAFTING_MODEL is a single switchable constant", () => {
  assert.equal(interview.KEEP_CRAFTING_MODEL, "claude-opus-4-8");
});

test("fallbackOutreachSubject is deterministic from person/company", () => {
  const a = interview.fallbackOutreachSubject("Hamid Dadkhah", "Ramp");
  const b = interview.fallbackOutreachSubject("Hamid Dadkhah", "Ramp");
  assert.equal(a, b);
  assert.match(a, /Hamid Dadkhah/);
  assert.match(a, /Ramp/);
  assert.ok(a.length <= 90);
});

test("normalizeOutreachSubject rejects empty and cleans Re:", () => {
  assert.equal(interview.normalizeOutreachSubject({ subject: "  " }, "Hamid", "Ramp"), null);
  assert.equal(
    interview.normalizeOutreachSubject({ subject: 'Re: Quick note about Ramp' }, "Hamid", "Ramp"),
    "Quick note about Ramp",
  );
});

test("parseSubjectResponse accepts JSON and bare lines", () => {
  assert.equal(
    interview.parseSubjectResponse('{"subject":"Building reliability with ownership"}').subject,
    "Building reliability with ownership",
  );
  assert.equal(
    interview.parseSubjectResponse("```json\n{\"subject\":\"Hello Hamid\"}\n```").subject,
    "Hello Hamid",
  );
});

test("buildSubjectUserMessage is generic (no hardcoded Tyler copy)", () => {
  const msg = interview.buildSubjectUserMessage({
    personName: "Hamid Dadkhah",
    personTitle: "Head of Engineering",
    companyName: "Ramp",
    companyContext: "Production engineering ownership",
    transcript: [
      { q: "What should they understand?", a: "Reliability with ownership." },
    ],
  });
  assert.match(msg, /Hamid Dadkhah/);
  assert.match(msg, /Ramp/);
  assert.match(msg, /Reliability with ownership/);
  assert.equal(/\bTyler\b/.test(msg), false);
});
