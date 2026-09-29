/* keepCrafting: always a next_question — helpers, retries, stage fallback. */
"use strict";

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");

const interview = require("../src/renderer/interview-prompt.js");
const followups = require("../api/_lib/followups.js");

test("normalizeKeepCraftingQuestion rejects done/stitch without a question", () => {
  assert.equal(
    interview.normalizeKeepCraftingQuestion({
      next_question: null,
      done: true,
      stitched_body: "premature",
      stitched_title: "Nope",
    }),
    null
  );
  assert.equal(interview.normalizeKeepCraftingQuestion({ next_question: "  ", done: false }), null);
  assert.equal(
    interview.normalizeKeepCraftingQuestion({
      next_question: "What are you noticing about the pace?",
      done: true,
      stitched_body: "ignore me",
    }),
    "What are you noticing about the pace?"
  );
});

test("fallbackKeepCraftingQuestion is deterministic by transcript stage", () => {
  const early = interview.fallbackKeepCraftingQuestion(1);
  const mid = interview.fallbackKeepCraftingQuestion(4);
  const late = interview.fallbackKeepCraftingQuestion(8);
  assert.equal(interview.transcriptStage(1), "early");
  assert.equal(interview.transcriptStage(4), "mid");
  assert.equal(interview.transcriptStage(8), "late");
  assert.match(early, /noticing|figuring|discovering/i);
  assert.match(mid, /clearer|contradiction|understanding/i);
  assert.match(late, /recognising|coming to see|learning/i);
  assert.equal(interview.fallbackKeepCraftingQuestion(1), early);
  assert.notEqual(early, mid);
});

test("buildFollowupRequest keepCrafting instructs next_question and forbids forceStitch combo", () => {
  const built = interview.buildFollowupRequest({
    transcript: [{ q: "What are you learning?", a: "the work is slower" }],
    keepCrafting: true,
  });
  assert.equal(built.error, undefined);
  assert.match(built.user, /Keep crafting/);
  assert.match(built.user, /MUST return a non-empty next_question/);
  assert.match(built.user, /done to false/i);

  const tighter = interview.buildFollowupRequest({
    transcript: [{ q: "What are you learning?", a: "the work is slower" }],
    keepCrafting: true,
    keepCraftingTighter: true,
  });
  assert.match(tighter.user, /REQUIRED/);

  const both = interview.buildFollowupRequest({
    transcript: [{ q: "Q", a: "A" }],
    keepCrafting: true,
    forceStitch: true,
  });
  assert.match(both.error, /forceStitch or keepCrafting/);
});

test("askFollowups keepCrafting retries empty/done then falls back", async () => {
  const anthropic = require("../api/_lib/anthropic.js");
  let calls = 0;
  const restore = mock.method(anthropic, "callAnthropic", async () => {
    calls += 1;
    return {
      text: JSON.stringify({
        next_question: null,
        done: true,
        stitched_title: "Nope",
        stitched_body: "premature stitch",
      }),
    };
  });
  try {
    const shaped = await followups.askFollowups({
      transcript: [{ q: "What are you learning?", a: "quiet software" }],
      keepCrafting: true,
    });
    assert.equal(calls, 3);
    assert.equal(shaped.done, false);
    assert.equal(shaped.stitched_body, null);
    assert.ok(shaped.next_question);
    assert.match(shaped.next_question, /noticing|figuring|discovering|clearer|contradiction|understanding|recognising|coming to see|learning/i);
    assert.deepEqual(shaped.questions, [shaped.next_question]);
  } finally {
    restore.mock.restore();
  }
});

test("askFollowups keepCrafting accepts a question on the second attempt", async () => {
  const anthropic = require("../api/_lib/anthropic.js");
  let calls = 0;
  const restore = mock.method(anthropic, "callAnthropic", async ({ messages }) => {
    calls += 1;
    const user = messages[0].content;
    if (calls === 1) {
      assert.match(user, /Keep crafting/);
      return {
        text: JSON.stringify({
          next_question: null,
          done: true,
          stitched_body: "nope",
        }),
      };
    }
    assert.match(user, /REQUIRED/);
    return {
      text: JSON.stringify({
        next_question: "What quiet part are you protecting while you figure this out?",
        done: false,
      }),
    };
  });
  try {
    const shaped = await followups.askFollowups({
      transcript: [{ q: "What are you learning?", a: "quiet software" }],
      keepCrafting: true,
    });
    assert.equal(calls, 2);
    assert.equal(shaped.done, false);
    assert.match(shaped.next_question, /quiet part/);
  } finally {
    restore.mock.restore();
  }
});
