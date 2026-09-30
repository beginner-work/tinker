/* Person interview-prep stepper: one pending question, remaining queue.
 * Same ### notes contract as lead notepad / reading workbook.
 * Unanswered headings stay queued; answered turns are transcript.
 */

"use strict";

const { mergeLeadNotes, notesHaveDoneMarker } = require("./notes-merge.js");

const DONE_MARKER = "__done__";

function parsePersonPrep(raw) {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  if (!text.trim()) {
    return { preamble: "", transcript: [], pending: "", queue: [], draft: "", done: false };
  }
  if (!/^###\s+/m.test(text)) {
    return {
      preamble: "",
      transcript: [],
      pending: "",
      queue: [],
      draft: text.trim(),
      done: false,
    };
  }
  const done = notesHaveDoneMarker(text);
  const firstHeading = text.search(/^###\s+/m);
  const preamble = firstHeading > 0 ? text.slice(0, firstHeading).replace(/\n+$/, "") : "";
  const body = firstHeading >= 0 ? text.slice(firstHeading) : text;
  const chunks = body.split(/^###\s+/m).filter((c) => String(c || "").trim());
  const transcript = [];
  const unanswered = [];
  let draft = "";
  chunks.forEach((chunk) => {
    const nl = chunk.indexOf("\n");
    const q = (nl === -1 ? chunk : chunk.slice(0, nl)).trim();
    const a = (nl === -1 ? "" : chunk.slice(nl + 1)).replace(/^\n+/, "").replace(/\n+$/, "");
    if (!q || q === DONE_MARKER) return;
    if (a.trim()) transcript.push({ q, a });
    else unanswered.push(q);
  });
  if (done) {
    return { preamble, transcript, pending: "", queue: [], draft: "", done: true };
  }
  const pending = unanswered[0] || "";
  const queue = unanswered.slice(1);
  return { preamble, transcript, pending, queue, draft, done: false };
}

function serializePersonPrep(preamble, transcript, pending, draft, queue) {
  const parts = [];
  const head = String(preamble || "").replace(/\n+$/, "");
  if (head) parts.push(head, "");
  (transcript || []).forEach((turn) => {
    if (!turn || !turn.q) return;
    parts.push("### " + String(turn.q).trim());
    parts.push(String(turn.a || "").trim());
    parts.push("");
  });
  if (pending) {
    parts.push("### " + String(pending).trim());
    parts.push(String(draft || "").trim());
    parts.push("");
  } else if (String(draft || "").trim()) {
    parts.push(String(draft).trim());
    parts.push("");
  }
  (queue || []).forEach((q) => {
    const text = String(q || "").trim();
    if (!text) return;
    parts.push("### " + text);
    parts.push("");
  });
  return parts.join("\n").replace(/\n+$/, "");
}

/** Append unanswered prep questions; keep existing answers and preamble. */
function seedPersonPrepQuestions(existingNotes, questions) {
  const parsed = parsePersonPrep(existingNotes);
  if (parsed.done) {
    throw Object.assign(new Error("Person prep is already done (__done__)."), { status: 400 });
  }
  const list = Array.isArray(questions) ? questions : [];
  const next = list
    .map((q) => String(q || "").trim())
    .filter(Boolean);
  if (!next.length) {
    throw Object.assign(new Error("questions must include at least one non-empty string."), { status: 400 });
  }
  const seen = new Set();
  function remember(q) {
    const key = String(q || "").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }
  parsed.transcript.forEach((t) => remember(t && t.q));
  if (parsed.pending) remember(parsed.pending);
  parsed.queue.forEach(remember);
  const additions = next.filter(remember);
  if (!parsed.pending) {
    parsed.pending = additions.shift() || "";
  }
  parsed.queue = parsed.queue.concat(additions);
  const serialized = serializePersonPrep(
    parsed.preamble,
    parsed.transcript,
    parsed.pending,
    parsed.draft,
    parsed.queue
  );
  return mergeLeadNotes(existingNotes, serialized);
}

function shapePersonPrep(parsed) {
  return {
    preamble: parsed.preamble || "",
    answered: (parsed.transcript || []).map((t) => ({ q: t.q, a: t.a || "" })),
    pending: parsed.pending || "",
    queue: Array.isArray(parsed.queue) ? parsed.queue.slice() : [],
    draft: parsed.draft || "",
    done: !!parsed.done,
    remaining: (parsed.pending ? 1 : 0) + (parsed.queue ? parsed.queue.length : 0),
  };
}

module.exports = {
  DONE_MARKER,
  parsePersonPrep,
  serializePersonPrep,
  seedPersonPrepQuestions,
  shapePersonPrep,
};
