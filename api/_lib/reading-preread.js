/* Generate one pre-read question for a reading-thread section.
 *
 * Uses the same KEEP_CRAFTING_MODEL path as Keep crafting / ask_followups.
 * Never accepts a caller system prompt. The question must be specific to
 * the section (title + theme) and earlier notepad notes. The generic
 * template is returned only when the model call fails or returns empty.
 */

"use strict";

const anthropic = require("./anthropic.js");
const interview = require("../../src/renderer/interview-prompt.js");

const MODEL = interview.KEEP_CRAFTING_MODEL || "claude-opus-4-8";

const SYSTEM = [
  "You help a founder prepare to read one section of a book.",
  "Return JSON only: {\"next_question\":\"...\",\"done\":false}.",
  "Ask exactly one concrete pre-read question grounded in THIS section's name and theme.",
  "When earlier notes exist, weave them in so the question continues from what they already wrote.",
  "Tie the question to their own product or work when the section theme invites it.",
  "Example for a language / ubiquitous-language section: ask about a place in their product where they and the code use different words for the same thing.",
  "Do NOT use a generic template like \"what do you want to notice\" or \"what do you want to get clearer on\".",
  "Do not summarize the section. Do not quiz them on content they have not read yet.",
  "Stay in plain language. No em dashes.",
].join(" ");

const FALLBACK_TEMPLATE_RE = /what do you want to notice or get clearer on/i;

function fallbackQuestion(bookTitle, sectionTitle) {
  const book = String(bookTitle || "this book").trim() || "this book";
  const section = String(sectionTitle || "this section").trim() || "this section";
  return `Before you open ${section} in ${book}, what do you want to notice or get clearer on as you read?`;
}

function isFallbackQuestion(text) {
  return FALLBACK_TEMPLATE_RE.test(String(text || ""));
}

function sectionTheme(sectionTitle) {
  const title = String(sectionTitle || "").trim();
  if (!title) return "";
  // Prefer the part after the last colon ("Chapter 1: Crunching Knowledge").
  const colon = title.lastIndexOf(":");
  if (colon >= 0 && colon < title.length - 1) {
    return title.slice(colon + 1).trim();
  }
  // Or the parenthetical theme ("… (Bounded Contexts)").
  const paren = title.match(/\(([^)]+)\)\s*$/);
  if (paren) return paren[1].trim();
  return title;
}

function clipNotes(notes, max) {
  const text = String(notes || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  const limit = Math.max(200, Number(max) || 2500);
  if (text.length <= limit) return text;
  return text.slice(text.length - limit);
}

function buildUser({ bookTitle, author, sectionTitle, priorSections, priorNotes, asked }) {
  const theme = sectionTheme(sectionTitle);
  const lines = [];
  lines.push("Book: " + String(bookTitle || "").trim() + (author ? " by " + String(author).trim() : "") + ".");
  lines.push("Next section title: " + String(sectionTitle || "").trim() + ".");
  if (theme) lines.push("Section theme to ground the question in: " + theme + ".");
  if (Array.isArray(priorSections) && priorSections.length) {
    lines.push("Sections already finished:");
    priorSections.forEach((title) => lines.push("- " + String(title || "").trim()));
  }
  const notes = clipNotes(priorNotes, 2500);
  if (notes) {
    lines.push("Founder's earlier reading notepad notes (use these; do not ignore them):");
    lines.push(notes);
  } else {
    lines.push("No earlier section notes yet — ground the question in the section theme and the founder's product work.");
  }
  if (Array.isArray(asked) && asked.length) {
    lines.push("Questions already asked (do not repeat):");
    asked.forEach((q) => lines.push("- " + String(q || "").trim()));
  }
  lines.push("");
  lines.push(
    interview.keepCraftingUserInstruction
      ? interview.keepCraftingUserInstruction({ tighter: false })
      : "Return a non-empty next_question. Set done false."
  );
  lines.push(
    "Ask one specific pre-read question for this section's theme. Not a generic notice/get-clearer template."
  );
  return lines.join("\n");
}

/**
 * @returns {Promise<{ question: string, source: "model"|"fallback", model: string }>}
 */
async function generatePreReadQuestionDetailed({
  bookTitle,
  author,
  sectionTitle,
  priorSections,
  priorNotes,
  asked,
} = {}) {
  const fallback = fallbackQuestion(bookTitle, sectionTitle);
  if (!process.env.ANTHROPIC_API_KEY) {
    return { question: fallback, source: "fallback", model: MODEL };
  }
  try {
    const result = await anthropic.callAnthropic({
      system: SYSTEM,
      messages: [{
        role: "user",
        content: buildUser({
          bookTitle,
          author,
          sectionTitle,
          priorSections,
          priorNotes,
          asked,
        }),
      }],
      model: MODEL,
      maxTokens: 512,
    });
    const parsed = interview.parseInterviewResponse(result.text);
    const askedList = Array.isArray(asked) ? asked : [];
    const q = interview.normalizeKeepCraftingQuestion
      ? interview.normalizeKeepCraftingQuestion(parsed, askedList)
      : String(parsed && parsed.next_question || "").trim() || null;
    if (q && !isFallbackQuestion(q)) {
      return { question: q, source: "model", model: MODEL };
    }
    if (q) {
      // Model echoed the template — treat as failure and keep fallback.
      return { question: fallback, source: "fallback", model: MODEL };
    }
  } catch (err) {
    // Any model/transport failure → deterministic fallback.
    return { question: fallback, source: "fallback", model: MODEL };
  }
  return { question: fallback, source: "fallback", model: MODEL };
}

async function generatePreReadQuestion(opts) {
  const detailed = await generatePreReadQuestionDetailed(opts);
  return detailed.question;
}

module.exports = {
  MODEL,
  FALLBACK_TEMPLATE_RE,
  fallbackQuestion,
  isFallbackQuestion,
  sectionTheme,
  buildUser,
  generatePreReadQuestion,
  generatePreReadQuestionDetailed,
};
