/* Person-thread Keep crafting: relationship-first prompt, no career/seed. */
"use strict";

const { test, mock } = require("node:test");
const assert = require("node:assert/strict");

const interview = require("../src/renderer/interview-prompt.js");
const followups = require("../api/_lib/followups.js");

test("PERSON_SYSTEM_PROMPT is relationship-first and bans resume/career framing", () => {
  assert.match(interview.PERSON_SYSTEM_PROMPT, /connect as a person/i);
  assert.match(interview.PERSON_SYSTEM_PROMPT, /curious about/i);
  assert.match(interview.PERSON_SYSTEM_PROMPT, /Never ask about or reference Tyler's resume/i);
  assert.match(interview.PERSON_SYSTEM_PROMPT, /career record/i);
  assert.match(interview.PERSON_SYSTEM_PROMPT, /story parts/i);
  assert.match(interview.PERSON_SYSTEM_PROMPT, /transactions/i);
  assert.match(interview.PERSON_SYSTEM_PROMPT, /light background only/i);
  assert.match(interview.PERSON_SYSTEM_PROMPT, /Do not ask what he wants them to understand/i);
  assert.equal(interview.PERSON_SYSTEM_PROMPT.includes("Recent transactions"), false);
  assert.equal(interview.PERSON_SYSTEM_PROMPT.includes("claiming an area as their business"), false);
  assert.equal(interview.PERSON_SYSTEM_PROMPT.includes("RULE 8 — TRANSACTIONS"), false);
  assert.notEqual(interview.PERSON_SYSTEM_PROMPT, interview.SYSTEM_PROMPT);
});

test("defaultPersonQuestion is personal curiosity, not self-promotion", () => {
  assert.equal(
    interview.defaultPersonQuestion("Hamid Dadkhah", "Ramp"),
    "What are you curious about in Hamid Dadkhah's work at Ramp?"
  );
  assert.equal(
    interview.defaultPersonQuestion("Faria Chaudhry", ""),
    "What are you curious about in Faria Chaudhry's work?"
  );
  assert.equal(
    interview.defaultPersonQuestion("", "").includes("understand about you"),
    false
  );
});

test("buildPersonUserMessage excludes career/story/transaction/seed and includes personal instruction", () => {
  const user = interview.buildPersonUserMessage({
    personName: "Hamid Dadkhah",
    personTitle: "Head of Engineering",
    companyName: "Ramp",
    companyContext: "Ramp builds finance tools for operators.",
    prepContext: "Met via a mutual intro.",
    transcript: [
      {
        q: "What are you curious about in Hamid Dadkhah's work at Ramp?",
        a: "How his team thinks about reliability ownership.",
      },
    ],
    pendingQuestion: "What would make a conversation feel natural?",
    draftAnswer: "Something about shared production scars.",
    asked: [
      "What are you curious about in Hamid Dadkhah's work at Ramp?",
      "What would make a conversation feel natural?",
    ],
    keepCrafting: true,
  });

  assert.match(user, /connect as a person/i);
  assert.match(user, /Hamid Dadkhah/);
  assert.match(user, /Company context \(light background only/);
  assert.match(user, /Ramp builds finance tools/);
  assert.match(user, /curious about|how he knows them|shared or admired|conversation feel natural/i);
  assert.match(user, /Keep crafting/i);
  assert.match(user, /not what he wants Hamid Dadkhah to understand about him/i);

  assert.equal(/Where the founder is right now/.test(user), false);
  assert.equal(/What the founder last purchased/.test(user), false);
  assert.equal(/Recent transactions:/.test(user), false);
  assert.equal(/Starter-pitch slides/.test(user), false);
  assert.equal(/THE FOUNDER'S WRITING VOICE/.test(user), false);
  assert.equal(/what the founder wants .+ to understand/i.test(user), false);
  // Ban list may name these topics; the user message must not carry those data blocks.
  assert.equal(/Verified facts:/.test(user), false);
  assert.equal(/Story part ids:/.test(user), false);
});

test("buildFollowupRequest with personName uses PERSON_SYSTEM_PROMPT and drops founder scene", () => {
  const built = interview.buildFollowupRequest({
    personName: "Andrew Glenn",
    personTitle: "VP Engineering",
    companyName: "Alloy",
    companyContext: "Alloy builds identity decisioning APIs.",
    transcript: [{ q: "What are you curious about in Andrew Glenn's work at Alloy?", a: "His bar for ownership." }],
    keepCrafting: true,
    // These must not leak into person prompts even if a caller passes them.
    seed: "coffee shop on Market",
    facing: "a hard week",
    lastPurchased: "a notebook",
    transactions: [{ date: "2026-09-01", merchant: "Cafe", amount: -4.5, category: "food" }],
    voice: "THE FOUNDER'S WRITING VOICE\nShort sentences.",
  });

  assert.equal(built.error, undefined);
  assert.equal(built.mode, "person");
  assert.equal(built.system, interview.PERSON_SYSTEM_PROMPT);
  assert.notEqual(built.system, interview.SYSTEM_PROMPT);
  assert.match(built.user, /Andrew Glenn/);
  assert.match(built.user, /light background only/);
  assert.match(built.user, /relationship-first|curious about|conversation feel natural|shared or admired/i);

  assert.equal(/coffee shop on Market/.test(built.user), false);
  assert.equal(/a hard week/.test(built.user), false);
  assert.equal(/a notebook/.test(built.user), false);
  assert.equal(/Recent transactions:/.test(built.user), false);
  assert.equal(/Cafe/.test(built.user), false);
  assert.equal(/THE FOUNDER'S WRITING VOICE/.test(built.system), false);
  assert.equal(/THE FOUNDER'S WRITING VOICE/.test(built.user), false);
  assert.equal(/claiming an area as their business/.test(built.system), false);
});

test("founder buildFollowupRequest is unchanged when personName is omitted", () => {
  const built = interview.buildFollowupRequest({
    transcript: [{ q: "What are you learning?", a: "the work is slower" }],
    keepCrafting: true,
    seed: "at the kitchen table",
  });
  assert.equal(built.mode, "interview");
  assert.ok(built.system.startsWith(interview.SYSTEM_PROMPT));
  assert.match(built.user, /Where the founder is right now: at the kitchen table/);
});

test("fallbackPersonKeepCraftingQuestion stays personal and skips repeats", () => {
  const q = interview.fallbackPersonKeepCraftingQuestion(1, []);
  assert.match(q, /curious|come across|came across|admire|reach out/i);
  assert.equal(/learning|figuring out|discovering/i.test(q), false);

  const asked = [...interview.PERSON_KEEP_CRAFTING_FALLBACKS.early];
  const next = interview.fallbackPersonKeepCraftingQuestion(asked.length, asked);
  assert.ok(next);
  assert.equal(interview.isRepeatQuestion(next, asked), false);
});

test("askFollowups person keepCrafting uses person prompt and person fallback", async () => {
  const anthropic = require("../api/_lib/anthropic.js");
  let calls = 0;
  let lastSystem = "";
  let lastUser = "";
  const restore = mock.method(anthropic, "callAnthropic", async ({ system, messages }) => {
    calls += 1;
    lastSystem = system;
    lastUser = messages[0].content;
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
      personName: "Hamid Dadkhah",
      companyName: "Ramp",
      companyContext: "Finance tools.",
      transcript: [
        {
          q: "What are you curious about in Hamid Dadkhah's work at Ramp?",
          a: "How they own reliability.",
        },
      ],
      keepCrafting: true,
      seed: "should be stripped",
      lastPurchased: "should be stripped",
      transactions: ["- 2026-09-01 Cafe -$4.50"],
      voice: "THE FOUNDER'S WRITING VOICE\nIgnore me.",
    });
    assert.equal(calls, 3);
    assert.equal(lastSystem, interview.PERSON_SYSTEM_PROMPT);
    assert.equal(/should be stripped/.test(lastUser), false);
    assert.equal(/Cafe/.test(lastUser), false);
    assert.equal(/THE FOUNDER'S WRITING VOICE/.test(lastSystem), false);
    assert.equal(shaped.done, false);
    assert.ok(shaped.next_question);
    assert.equal(
      interview.isRepeatQuestion(
        shaped.next_question,
        ["What are you curious about in Hamid Dadkhah's work at Ramp?"]
      ),
      false
    );
    // Person fallback pool, not founder learning pool.
    const founderFallbacks = Object.values(interview.KEEP_CRAFTING_FALLBACKS).flat();
    assert.equal(founderFallbacks.includes(shaped.next_question), false);
  } finally {
    restore.mock.restore();
  }
});
