/* Extract {question, tyler_answer} pairs from a published essay body.
 *
 * Writing prompts are stored inline as Markdown `> …` blockquotes
 * (see src/renderer/lib/essay-read.js). Tyler's prose is everything else.
 */

"use strict";

function splitSegments(body) {
  const src = String(body == null ? "" : body).replace(/\r\n/g, "\n");
  const lines = src.split("\n");
  const segments = [];
  let buf = [];
  let bufType = "prose";

  function flush() {
    const text = buf.join("\n").trim();
    if (text) segments.push({ type: bufType, text });
    buf = [];
  }

  for (const line of lines) {
    const m = /^(?:>|###)\s*(.+)$/.exec(line);
    if (m) {
      flush();
      segments.push({ type: "prompt", text: m[1].replace(/\s+/g, " ").trim() });
      bufType = "prose";
      continue;
    }
    if (bufType !== "prose") {
      flush();
      bufType = "prose";
    }
    buf.push(line);
  }
  flush();
  return segments;
}

function proseOnly(body) {
  return splitSegments(body)
    .filter((s) => s.type === "prose")
    .map((s) => s.text)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractPrompts(body) {
  return splitSegments(body)
    .filter((s) => s.type === "prompt")
    .map((s) => s.text)
    .filter(Boolean);
}

/**
 * Build dataset rows for one essay.
 * One row per writing prompt; if none, one fallback row from the title /
 * opening line so freewrites still enter the agreement baseline.
 */
function pairsFromEssay(essay, { minProseChars = 40, maxPromptsPerEssay = 6 } = {}) {
  if (!essay || typeof essay !== "object") return [];
  const id = String(essay.id || "").trim();
  if (!id) return [];
  const body = String(essay.body == null ? "" : essay.body);
  const prose = proseOnly(body);
  if (prose.length < minProseChars) return [];

  const title = String(essay.title || essay.storedTitle || "").trim();
  const prompts = extractPrompts(body).slice(0, maxPromptsPerEssay);
  const rows = [];

  if (prompts.length) {
    prompts.forEach((question, promptIndex) => {
      rows.push({
        id: `essay-${id}-p${String(promptIndex + 1).padStart(2, "0")}`,
        question,
        source: "essay",
        tyler_answer: prose,
        essayId: id,
        essayTitle: title,
        promptIndex,
        category: "agreement",
        input: "typed",
        notes: `Writing prompt ${promptIndex + 1} from essay ${id}; reference is Tyler's prose.`,
      });
    });
  } else {
    const opening = prose.split(/\n\n/)[0] || title;
    const question = title
      ? `What are you learning about: ${title}?`
      : `What are you learning? (${opening.slice(0, 120)})`;
    rows.push({
      id: `essay-${id}-freewrite`,
      question,
      source: "essay",
      tyler_answer: prose,
      essayId: id,
      essayTitle: title,
      promptIndex: null,
      category: "agreement",
      input: "typed",
      notes: `Freewrite essay ${id} (no > prompts); question synthesized from title.`,
    });
  }
  return rows;
}

function summarizePairs(rows) {
  const bySource = {};
  const byCategory = {};
  const essayIds = new Set();
  for (const r of rows) {
    bySource[r.source] = (bySource[r.source] || 0) + 1;
    byCategory[r.category] = (byCategory[r.category] || 0) + 1;
    if (r.essayId) essayIds.add(r.essayId);
  }
  return {
    cases: rows.length,
    essays: essayIds.size,
    bySource,
    byCategory,
  };
}

module.exports = {
  splitSegments,
  proseOnly,
  extractPrompts,
  pairsFromEssay,
  summarizePairs,
};
