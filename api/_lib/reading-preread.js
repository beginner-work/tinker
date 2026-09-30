/* Generate one pre-read question for a reading-thread section.
 *
 * Uses the same KEEP_CRAFTING_MODEL path as Keep crafting / ask_followups.
 * Never accepts a caller system prompt. Falls back to a static question
 * when Anthropic is unavailable so create/advance still work in tests.
 */

"use strict";

const anthropic = require("./anthropic.js");
const interview = require("../../src/renderer/interview-prompt.js");

const MODEL = interview.KEEP_CRAFTING_MODEL || "claude-opus-4-8";

const SYSTEM = [
  "You help a founder prepare to read one section of a book.",
  "Return JSON only: {\"next_question\":\"...\",\"done\":false}.",
  "Ask exactly one concrete pre-read question that orients them before they open that section.",
  "Do not summarize the section. Do not quiz them on content they have not read yet.",
  "Stay in plain language. No em dashes.",
].join(" ");

function fallbackQuestion(bookTitle, sectionTitle) {
  const book = String(bookTitle || "this book").trim() || "this book";
  const section = String(sectionTitle || "this section").trim() || "this section";
  return `Before you open ${section} in ${book}, what do you want to notice or get clearer on as you read?`;
}

function buildUser({ bookTitle, author, sectionTitle, priorSections, asked }) {
  const lines = [];
  lines.push("Book: " + String(bookTitle || "").trim() + (author ? " by " + String(author).trim() : "") + ".");
  lines.push("Next section to prepare for: " + String(sectionTitle || "").trim() + ".");
  if (Array.isArray(priorSections) && priorSections.length) {
    lines.push("Sections already finished:");
    priorSections.forEach((title) => lines.push("- " + String(title || "").trim()));
  }
  if (Array.isArray(asked) && asked.length) {
    lines.push("Questions already asked (do not repeat):");
    asked.forEach((q) => lines.push("- " + String(q || "").trim()));
  }
  lines.push("");
  lines.push(
    interview.keepCraftingUserInstruction
      ? interview.keepCraftingUserInstruction({ tighter: false })
      : 'Return a non-empty next_question. Set done false.'
  );
  lines.push("Ask one pre-read question that gets them ready for this section.");
  return lines.join("\n");
}

async function generatePreReadQuestion({
  bookTitle,
  author,
  sectionTitle,
  priorSections,
  asked,
} = {}) {
  const fallback = fallbackQuestion(bookTitle, sectionTitle);
  if (!process.env.ANTHROPIC_API_KEY) return fallback;
  try {
    const result = await anthropic.callAnthropic({
      system: SYSTEM,
      messages: [{
        role: "user",
        content: buildUser({ bookTitle, author, sectionTitle, priorSections, asked }),
      }],
      model: MODEL,
      maxTokens: 512,
    });
    const parsed = interview.parseInterviewResponse(result.text);
    const askedList = Array.isArray(asked) ? asked : [];
    const q = interview.normalizeKeepCraftingQuestion
      ? interview.normalizeKeepCraftingQuestion(parsed, askedList)
      : String(parsed && parsed.next_question || "").trim() || null;
    if (q) return q;
  } catch (err) {
    // Transport / key errors → deterministic fallback; create/advance must not fail the thread.
    if (err && err.status === 503) return fallback;
  }
  return fallback;
}

module.exports = {
  MODEL,
  fallbackQuestion,
  generatePreReadQuestion,
};
