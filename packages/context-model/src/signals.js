"use strict";

/** @typedef {import('./schema.js').SignalType} SignalType */

const SIGNAL_TYPES = Object.freeze([
  "honest_statement",
  "reading",
  "ask",
  "skip",
  "response",
  "lecture",
  "explanation",
]);

/**
 * Normalize an inbound learning signal.
 *
 * Later sources (Claude Code, GitHub) can map into these kinds with
 * opt-in consent; they are not ingested by default.
 *
 * @param {object} raw
 */
function normalizeSignal(raw) {
  if (!raw || typeof raw !== "object") {
    throw Object.assign(new Error("signal must be an object"), { status: 400 });
  }
  const type = String(raw.type || "").trim();
  if (!SIGNAL_TYPES.includes(type)) {
    throw Object.assign(
      new Error(
        `unknown signal type "${type}"; expected one of ${SIGNAL_TYPES.join(", ")}`,
      ),
      { status: 400 },
    );
  }
  const conceptIds = normalizeConceptIds(raw.conceptIds || raw.conceptId);
  const at = raw.at ? new Date(raw.at).toISOString() : new Date().toISOString();
  if (Number.isNaN(Date.parse(at))) {
    throw Object.assign(new Error("invalid signal.at"), { status: 400 });
  }

  const base = {
    type,
    conceptIds,
    at,
    sessionId: raw.sessionId ? String(raw.sessionId) : null,
    sourceId: raw.sourceId != null ? String(raw.sourceId) : null,
    payload: raw.payload && typeof raw.payload === "object" ? raw.payload : {},
  };

  if (type === "honest_statement") {
    const text = String(
      (raw.text != null ? raw.text : raw.payload && raw.payload.text) || "",
    ).trim();
    if (!text) {
      throw Object.assign(new Error("honest_statement requires text"), {
        status: 400,
      });
    }
    return { ...base, text, payload: { ...base.payload, text } };
  }

  if (type === "response") {
    const correct = Boolean(
      raw.correct != null
        ? raw.correct
        : raw.payload && raw.payload.correct,
    );
    const aided = Boolean(
      raw.aided != null ? raw.aided : raw.payload && raw.payload.aided,
    );
    return {
      ...base,
      correct,
      aided,
      payload: { ...base.payload, correct, aided },
    };
  }

  if (type === "skip" || type === "reading" || type === "ask") {
    if (!conceptIds.length && !base.sourceId) {
      throw Object.assign(
        new Error(`${type} requires conceptIds or sourceId`),
        { status: 400 },
      );
    }
  }

  return base;
}

/** @param {unknown} value */
function normalizeConceptIds(value) {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) {
    return [...new Set(value.map((v) => String(v).trim()).filter(Boolean))];
  }
  return [String(value).trim()].filter(Boolean);
}

/**
 * Validate a batch of signals (ingest interface).
 * @param {unknown} body
 */
function parseSignalBatch(body) {
  if (!body || typeof body !== "object") {
    throw Object.assign(new Error("body must be an object"), { status: 400 });
  }
  const list = Array.isArray(body.signals)
    ? body.signals
    : body.signal
      ? [body.signal]
      : null;
  if (!list || !list.length) {
    throw Object.assign(new Error("signals array required"), { status: 400 });
  }
  if (list.length > 100) {
    throw Object.assign(new Error("at most 100 signals per request"), {
      status: 400,
    });
  }
  return list.map(normalizeSignal);
}

module.exports = {
  SIGNAL_TYPES,
  normalizeSignal,
  normalizeConceptIds,
  parseSignalBatch,
};
