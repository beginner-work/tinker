/* Shared notepad merge helpers for leads and reading threads.
 *
 * Same contract as #395: omitted/empty incoming cannot wipe Q&A;
 * a trailing ### __done__ on existing notes is preserved when the
 * incoming body lacks it.
 */

"use strict";

const DONE_MARKER_LINE = "### __done__";
const MAX_NOTES = 8000;

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function clipNotes(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw fail(400, "notes must be a string.");
  const text = value.trim();
  if (text.length > MAX_NOTES) throw fail(400, `notes is limited to ${MAX_NOTES} characters.`);
  return text;
}

function notesHaveDoneMarker(text) {
  return /(?:^|\n)###\s*__done__\s*(?:\n|$)/.test(String(text || ""));
}

/** Preserve completed Keep crafting / reading state across field updates. */
function mergeLeadNotes(existing, incoming) {
  const prev = String(existing || "");
  // Omitted incoming must never wipe an existing notepad.
  if (incoming == null) return prev;
  const next = clipNotes(incoming);
  // Explicit empty must not wipe Q&A that already exists.
  if (!String(next || "").trim() && prev.trim()) return prev;
  if (notesHaveDoneMarker(prev) && !notesHaveDoneMarker(next)) {
    const trimmed = String(next || "").replace(/\n+$/, "");
    return (trimmed ? trimmed + "\n\n" : "") + DONE_MARKER_LINE + "\n";
  }
  if (notesHaveDoneMarker(next)) {
    return String(next || "").replace(/\n+$/, "") + "\n";
  }
  return next;
}

function ensureDoneMarker(notes) {
  const text = String(notes || "").replace(/\r\n/g, "\n");
  if (notesHaveDoneMarker(text)) return text.replace(/\n+$/, "") + "\n";
  const trimmed = text.replace(/\n+$/, "");
  return (trimmed ? trimmed + "\n\n" : "") + DONE_MARKER_LINE + "\n";
}

module.exports = {
  DONE_MARKER_LINE,
  MAX_NOTES,
  notesHaveDoneMarker,
  mergeLeadNotes,
  ensureDoneMarker,
};
