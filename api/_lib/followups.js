/* ask_followups — server-owned interview and freeform follow-ups.
 *
 * Fixed prompts only. Callers cannot supply a system prompt; that would
 * turn the MCP surface into an open Anthropic proxy. The founder
 * interview uses the same contract the writing UI sends.
 */

"use strict";

const { callAnthropic } = require("./anthropic.js");
const interview = require("../../src/renderer/interview-prompt.js");

// Same model the writing UI passes to /api/claude/converse.
const INTERVIEW_MODEL = "claude-opus-4-8";

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

async function askFollowups(args) {
  const built = interview.buildFollowupRequest(args);
  if (built.error) {
    throw Object.assign(new Error(built.error), { toolError: true });
  }
  const result = await callAnthropic({
    system: built.system,
    messages: [{ role: "user", content: built.user }],
    model: INTERVIEW_MODEL,
    maxTokens: 2048,
  });
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

module.exports = { askFollowups, INTERVIEW_MODEL };
