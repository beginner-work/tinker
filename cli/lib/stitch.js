"use strict";

/** Founder-only stitch helpers (same rules as src/renderer/writing.js). */

function tokens(s) {
  return String(s || "")
    .toLowerCase()
    .match(/[a-z0-9'']+/g) || [];
}

function verifyFounderOnly(stitched, transcript) {
  const corpus = (transcript || []).map((t) => t.a).join(" ");
  const have = new Set(tokens(corpus));
  const need = tokens(stitched);
  const foreign = [];
  for (const w of need) {
    if (!have.has(w)) foreign.push(w);
  }
  return { ok: foreign.length === 0, foreign };
}

function phraseAppearsIn(phrase, corpus) {
  const c = corpus.toLowerCase().replace(/\s+/g, " ");
  const p = (phrase || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!p) return false;
  return c.includes(p);
}

function firstSentence(text) {
  const s = String(text || "").trim();
  const m = s.match(/^[^.!?\n]{1,80}[.!?]?/);
  return m ? m[0].trim() : s.slice(0, 60);
}

function joinAnswers(transcript) {
  return (transcript || [])
    .map((t) => String(t && t.a || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Turn a model stitch (or fallback) into a founder-only essay.
 */
function finalizeEssay(parsed, transcript) {
  const corpus = joinAnswers(transcript);
  let body = (parsed && parsed.stitched_body) || "";
  let title =
    (parsed && parsed.stitched_title) ||
    firstSentence(corpus) ||
    "Untitled";
  const verified = body ? verifyFounderOnly(body, transcript) : { ok: false };
  if (!body || !verified.ok) {
    body = corpus;
    if (!phraseAppearsIn(title, corpus)) {
      title = firstSentence(body) || "Untitled";
    }
  }
  return {
    title: String(title || "Untitled").trim() || "Untitled",
    body: String(body || "").trim(),
  };
}

module.exports = {
  tokens,
  verifyFounderOnly,
  phraseAppearsIn,
  firstSentence,
  joinAnswers,
  finalizeEssay,
};
