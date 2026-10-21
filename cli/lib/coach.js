"use strict";

const interview = require("./interview.js");
const { finalizeEssay } = require("./stitch.js");

/**
 * Core writing coach loop — one short question at a time.
 * No steps, plans, or numbered lists. Compact for a short terminal panel.
 *
 * Dependencies are injected so tests can mock the LLM and I/O.
 *
 * @param {object} deps
 * @param {(args: object) => Promise<object>} deps.askModel
 *   Receives { transcript, forceStitch?, keepCrafting? } and returns
 *   { next_question, stitched_title, stitched_body, done } (interview shape).
 * @param {() => Promise<{kind:'answer'|'finish'|'quit', text:string}>} deps.readAnswer
 * @param {(line: string) => void} deps.write  print a line (no trailing extra blanks)
 * @param {(essay: {title:string, body:string}) => Promise<{ok:boolean, message?:string}>} deps.saveEssay
 */

async function askNextQuestion(askModel, transcript) {
  const asked = interview.collectAskedQuestions(transcript, [], null);
  // Prefer a real next question; keepCrafting avoids early stitch.
  const keepCrafting = transcript.length > 0;
  const parsed = await askModel({
    transcript,
    keepCrafting,
    forceStitch: false,
  });
  let q = null;
  if (keepCrafting) {
    q = interview.normalizeKeepCraftingQuestion(parsed, asked);
  } else {
    q = String((parsed && parsed.next_question) || "").trim() || null;
    if (q) q = interview.sanitizeAiQuestion(q) || q;
  }
  if (!q) {
    q = interview.fallbackKeepCraftingQuestion(transcript.length, asked);
  }
  return q;
}

async function stitchEssay(askModel, transcript) {
  if (!transcript.length) {
    return { title: "", body: "" };
  }
  let parsed;
  try {
    parsed = await askModel({
      transcript,
      forceStitch: true,
      keepCrafting: false,
    });
  } catch {
    parsed = { stitched_title: null, stitched_body: null, done: true };
  }
  return finalizeEssay(parsed, transcript);
}

async function runCoach(deps) {
  const {
    askModel,
    readAnswer,
    write,
    saveEssay,
  } = deps;
  if (typeof askModel !== "function") throw new Error("askModel required");
  if (typeof readAnswer !== "function") throw new Error("readAnswer required");
  if (typeof write !== "function") throw new Error("write required");
  if (typeof saveEssay !== "function") throw new Error("saveEssay required");

  const transcript = [];
  let pending = await askNextQuestion(askModel, transcript);

  for (;;) {
    write(pending);
    const turn = await readAnswer();
    if (turn.kind === "quit") {
      write("Left without saving.");
      return { status: "quit", transcript, essay: null };
    }

    if (turn.kind === "finish") {
      const partial = String(turn.text || "").trim();
      if (partial) {
        transcript.push({ q: pending, a: partial });
      }
      if (!transcript.length) {
        write("Nothing to save yet.");
        continue;
      }
      const essay = await stitchEssay(askModel, transcript);
      if (!essay.body) {
        write("Nothing to save yet.");
        continue;
      }
      const saved = await saveEssay(essay);
      if (saved && saved.ok) {
        write("Saved to Notion.");
        return { status: "saved", transcript, essay };
      }
      write((saved && saved.message) || "Could not save this essay to Notion.");
      return { status: "error", transcript, essay, error: saved };
    }

    const answer = String(turn.text || "").trim();
    if (!answer) {
      write("Type an answer, or: this is everything");
      continue;
    }
    transcript.push({ q: pending, a: answer });
    pending = await askNextQuestion(askModel, transcript);
  }
}

/**
 * Build askModel that talks to /api/claude/converse using interview-prompt.
 */
function createApiAskModel(converseFn, config) {
  return async function askModel({ transcript, forceStitch, keepCrafting }) {
    const built = interview.buildFollowupRequest({
      transcript,
      forceStitch: !!forceStitch,
      keepCrafting: !!keepCrafting,
    });
    if (built.error) {
      throw new Error(built.error);
    }
    const result = await converseFn(config, {
      system: built.system,
      messages: [{ role: "user", content: built.user }],
      model: interview.KEEP_CRAFTING_MODEL,
      maxTokens: 2048,
    });
    return interview.parseInterviewResponse(result && result.text);
  };
}

module.exports = {
  runCoach,
  askNextQuestion,
  stitchEssay,
  createApiAskModel,
};
