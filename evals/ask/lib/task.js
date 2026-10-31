/* Task under test: produce a Tyler-voice answer for a dataset question.
 *
 * Essay/agreement cases: Claude answers in Tyler's voice using a holdout
 * style pack (other essays, excluding the reference essay). Never sees
 * tyler_answer.
 *
 * Synthetic / visitor /ask-style cases: reuse POST /api/ask grounded
 * answer helper (Claude + minds-and-models corpus) when category is not
 * agreement.
 *
 * No OpenAI. No voice id JlYdFGRHWwlz51Zh5K2n (text-only).
 */

"use strict";

const ask = require("../../../api/_lib/ask.js");
const reading = require("../../../api/_lib/reading-agent.js");
const { callAnthropic } = require("../../../api/_lib/anthropic.js");
const models = require("../../../src/renderer/lib/claude-models.js");
const { proseOnly } = require("./extract-pairs.js");
const load = require("./load-dataset.js");

const VOICE_SYSTEM = [
  "You answer as Tyler's agent, in Tyler's first-person writing voice.",
  "Match his stance, cadence, and concrete claims from the STYLE CORPUS.",
  "Do not invent employers, titles, numbers, or facts absent from the corpus.",
  "Reply in 2 to 6 short spoken paragraphs (or fewer if the prompt is narrow).",
  "No markdown bullets. No preamble about being an AI.",
].join("\n");

function buildStyleCorpus(essays, excludeEssayId, maxChars = 14000) {
  const list = Array.isArray(essays) ? essays : [];
  const parts = [];
  let used = 0;
  for (const e of list) {
    if (!e || e.id === excludeEssayId) continue;
    const prose = proseOnly(e.body);
    if (prose.length < 80) continue;
    const chunk = `### ${e.title || e.id}\n${prose.slice(0, 1200)}`;
    if (used + chunk.length > maxChars) break;
    parts.push(chunk);
    used += chunk.length;
  }
  return parts.join("\n\n---\n\n");
}

async function answerInTylerVoice({ question, excludeEssayId, essays }) {
  const style = buildStyleCorpus(essays, excludeEssayId);
  const system = `${VOICE_SYSTEM}\n\n---\nSTYLE CORPUS\n---\n\n${style || "(empty)"}`;
  const started = Date.now();
  const result = await callAnthropic({
    system,
    messages: [{ role: "user", content: `Prompt:\n${question}` }],
    model: process.env.ASK_MODEL || models.FAST || "claude-haiku-4-5-20251001",
    maxTokens: 700,
  });
  return {
    answerText: String((result && result.text) || "").trim(),
    latencyMs: Date.now() - started,
    model: process.env.ASK_MODEL || models.FAST || "claude-haiku-4-5-20251001",
    path: "tyler-voice",
  };
}

async function answerGroundedAsk(caseRow) {
  const source = ask.loadSource(caseRow.sourceId || "lindowlabs-minds-and-models");
  if (!source) {
    throw new Error(`unknown sourceId ${caseRow.sourceId}`);
  }
  const started = Date.now();
  const answered = await ask.answerWithClaude({
    source,
    question: caseRow.question,
    input: caseRow.input || "typed",
    rawTranscript: caseRow.rawTranscript || "",
    position: caseRow.position || null,
    context: caseRow.context || "",
  });
  return {
    answerText: answered.answerText,
    latencyMs: Date.now() - started,
    model: answered.model,
    path: "api-ask",
  };
}

async function answerReadingCase(caseRow, { pages } = {}) {
  const list = Array.isArray(pages) ? pages : load.loadReadingPagesFixture();
  const page = list.find((p) => p && p.id === caseRow.pageId) || list[0];
  if (!page) {
    throw new Error(`missing reading page fixture for ${caseRow.pageId}`);
  }
  const linked = page.linkedPages || {};
  const fetchPageFn = async (url) => {
    const hit = linked[url];
    if (!hit) {
      throw Object.assign(new Error("linked page not in fixture"), { status: 404 });
    }
    return {
      sourceUrl: url,
      requestedUrl: url,
      title: hit.title || "",
      author: hit.author || "",
      text: hit.text || "",
      paragraphs: String(hit.text || "").split(/\n\s*\n/),
      wordCount: String(hit.text || "").split(/\s+/).filter(Boolean).length,
      links: [],
      fetchedAt: new Date().toISOString(),
    };
  };

  const decision = reading.decideFetchLink({
    question: caseRow.question,
    links: page.links || [],
  });

  const started = Date.now();
  const answered = await reading.answerReadingQuestion({
    title: page.title,
    author: page.author,
    sourceUrl: page.sourceUrl,
    text: page.text,
    links: page.links || [],
    question: caseRow.question,
    input: caseRow.input || "typed",
    rawTranscript: caseRow.rawTranscript || "",
    position: caseRow.position || null,
    fetchPageFn,
  });

  const resumeWordIndex =
    caseRow.position && typeof caseRow.position.wordIndex === "number"
      ? caseRow.position.wordIndex
      : 0;

  return {
    answerText: answered.answerText,
    latencyMs: Date.now() - started,
    model: answered.model,
    path: "reading-agent",
    toolUsed: Boolean(answered.toolUsed),
    fetchedSourceUrl: answered.fetchedSourceUrl || "",
    shouldFetchDecision: decision,
    resumeWordIndex,
    pageId: page.id,
    sourceUrl: page.sourceUrl,
  };
}

async function runTask(caseRow, { essays, pages } = {}) {
  const category = caseRow.category || "agreement";
  if (
    caseRow.source === "reading" ||
    String(category).startsWith("reading_")
  ) {
    return answerReadingCase(caseRow, { pages });
  }
  if (category === "agreement" || caseRow.source === "essay") {
    return answerInTylerVoice({
      question: caseRow.question,
      excludeEssayId: caseRow.essayId || null,
      essays: essays || [],
    });
  }
  return answerGroundedAsk(caseRow);
}

module.exports = {
  buildStyleCorpus,
  answerInTylerVoice,
  answerGroundedAsk,
  answerReadingCase,
  runTask,
  VOICE_SYSTEM,
};
