/* ask_followups — server-owned interview and freeform follow-ups.
 *
 * Fixed prompts only. Callers cannot supply a system prompt; that would
 * turn the MCP surface into an open Anthropic proxy. The founder
 * interview uses the same contract the writing UI sends.
 *
 * keepCrafting means the owner wants another question: never return
 * done/stitch, and never repeat a question already in the transcript.
 * Empty or duplicate model replies retry (tighter prompt) up to twice,
 * then fall back to an unused stage question.
 */

"use strict";

const anthropic = require("./anthropic.js");
const interview = require("../../src/renderer/interview-prompt.js");
const { KEEP_CRAFTING_MODEL } = require("./keep-crafting-model.js");

// Same model the writing UI / person Keep crafting path pass to converse.
const INTERVIEW_MODEL = KEEP_CRAFTING_MODEL;
const KEEP_CRAFTING_MAX_ATTEMPTS = 3; // initial + up to 2 tighter retries

function shapeInterview(parsed) {
  const next = parsed.next_question || null;
  return {
    mode: "interview",
    next_question: next,
    questions: next ? [next] : [],
    stitched_title: parsed.stitched_title || null,
    stitched_body: parsed.stitched_body || null,
    done: !!parsed.done,
  };
}

function shapeFreeform(parsed) {
  const questions = parsed.questions || [];
  return {
    mode: "freeform",
    next_question: questions[0] || null,
    questions,
    stitched_title: null,
    stitched_body: null,
    done: false,
  };
}

function askedFromArgs(args) {
  return interview.collectAskedQuestions(
    Array.isArray(args && args.transcript) ? args.transcript : [],
    Array.isArray(args && args.priorTurns) ? args.priorTurns : [],
    args && args.pendingQuestion
  );
}

function turnCountFromArgs(args) {
  return askedFromArgs(args).length;
}

async function callOnce(built) {
  const result = await anthropic.callAnthropic({
    system: built.system,
    messages: [{ role: "user", content: built.user }],
    model: INTERVIEW_MODEL,
    maxTokens: 2048,
  });
  return result;
}

async function askKeepCrafting(args) {
  const asked = askedFromArgs(args);
  for (let attempt = 0; attempt < KEEP_CRAFTING_MAX_ATTEMPTS; attempt++) {
    const attemptArgs = Object.assign({}, args, {
      keepCrafting: true,
      keepCraftingTighter: attempt > 0,
      forceStitch: false,
    });
    const built = interview.buildFollowupRequest(attemptArgs);
    if (built.error) {
      throw Object.assign(new Error(built.error), { toolError: true });
    }
    // Network/server failures propagate immediately — retries are only for
    // empty/done/duplicate model payloads, not transport errors.
    const result = await callOnce(built);
    const parsed = interview.parseInterviewResponse(result.text);
    const q = interview.normalizeKeepCraftingQuestion(parsed, asked);
    if (q) {
      return shapeInterview({
        next_question: q,
        stitched_title: null,
        stitched_body: null,
        done: false,
      });
    }
  }
  const q = interview.fallbackKeepCraftingQuestion(turnCountFromArgs(args), asked);
  return shapeInterview({
    next_question: q,
    stitched_title: null,
    stitched_body: null,
    done: false,
  });
}

async function askFollowups(args) {
  const input = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  if (input.keepCrafting === true) {
    return askKeepCrafting(input);
  }

  const built = interview.buildFollowupRequest(args);
  if (built.error) {
    throw Object.assign(new Error(built.error), { toolError: true });
  }
  const result = await callOnce(built);
  if (built.mode === "interview") {
    return shapeInterview(interview.parseInterviewResponse(result.text));
  }
  const shaped = shapeFreeform(interview.parseFreeformResponse(result.text));
  if (shaped.questions.length === 0) {
    throw Object.assign(new Error("The model did not return follow-up questions."), {
      toolError: true,
    });
  }
  return shaped;
}

module.exports = { askFollowups, INTERVIEW_MODEL, KEEP_CRAFTING_MAX_ATTEMPTS };
