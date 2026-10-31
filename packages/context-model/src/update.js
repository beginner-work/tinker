"use strict";

const { makeBelief, levelToDepth, DEPTH_MAX_LEVEL } = require("./schema.js");
const { normalizeSignal } = require("./signals.js");

/**
 * Deterministic belief update from a normalized signal.
 * Jev/Claude can supply an optional depthScore override for honest_statement.
 *
 * @param {import('./schema.js').ConceptGraph} graph
 * @param {string} userId
 * @param {object} rawSignal
 * @param {{ depthScore?: number, depthConfidence?: number, conceptIds?: string[] }} [opts]
 */
function applySignal(graph, userId, rawSignal, opts) {
  const signal = normalizeSignal(rawSignal);
  const conceptIds =
    (opts && opts.conceptIds && opts.conceptIds.length
      ? opts.conceptIds
      : signal.conceptIds) || [];
  const results = [];

  if (!conceptIds.length) {
    return { signal, updates: results };
  }

  for (const conceptId of conceptIds) {
    if (!graph.concepts.has(conceptId)) {
      graph.upsertConcept({ id: conceptId, slug: conceptId, title: conceptId });
    }
    const prior = graph.getBelief(userId, conceptId);
    const next = updateBelief(prior, signal, opts);
    graph.setBelief(userId, conceptId, next);
    results.push({ conceptId, prior, next });
  }

  return { signal, updates: results };
}

/**
 * @param {ReturnType<typeof makeBelief>} prior
 * @param {ReturnType<typeof normalizeSignal>} signal
 * @param {{ depthScore?: number, depthConfidence?: number }} [opts]
 */
function updateBelief(prior, signal, opts) {
  const p = makeBelief(prior);
  let depth = p.depth;
  let confidence = p.confidence;
  let evidenceCount = p.evidenceCount + 1;

  switch (signal.type) {
    case "honest_statement": {
      if (typeof (opts && opts.depthScore) === "number") {
        const scored = clamp01(opts.depthScore);
        const w = clamp01(
          typeof (opts && opts.depthConfidence) === "number"
            ? opts.depthConfidence
            : 0.6,
        );
        depth = blend(depth, scored, Math.max(0.35, w));
        confidence = clamp01(confidence * 0.5 + w * 0.5 + 0.1);
      } else {
        // Without Jev: weak prior bump from having self-reported at all.
        depth = blend(depth, Math.min(1, depth + 0.05), 0.2);
        confidence = clamp01(confidence + 0.05);
      }
      break;
    }
    case "response": {
      if (signal.correct && !signal.aided) {
        depth = blend(depth, Math.min(1, depth + 0.15), 0.55);
        confidence = clamp01(confidence + 0.12);
      } else if (signal.correct && signal.aided) {
        depth = blend(depth, Math.min(1, depth + 0.08), 0.4);
        confidence = clamp01(confidence + 0.06);
      } else if (!signal.correct && signal.aided) {
        depth = blend(depth, Math.max(0, depth - 0.1), 0.45);
        confidence = clamp01(confidence * 0.85);
      } else {
        depth = blend(depth, Math.max(0, depth - 0.12), 0.5);
        confidence = clamp01(confidence * 0.8 + 0.05);
      }
      break;
    }
    case "lecture":
    case "explanation":
    case "reading": {
      depth = blend(depth, Math.min(1, depth + 0.04), 0.25);
      confidence = clamp01(confidence + 0.03);
      break;
    }
    case "ask": {
      // Asking about a concept is a weak "near ZPD" signal: not mastery, not blank.
      const working = levelToDepth(2);
      depth = blend(depth, working, 0.2);
      confidence = clamp01(confidence + 0.04);
      break;
    }
    case "skip": {
      depth = blend(depth, Math.max(0, depth - 0.03), 0.2);
      confidence = clamp01(confidence * 0.9);
      break;
    }
    default:
      break;
  }

  return makeBelief({ depth, confidence, evidenceCount });
}

/**
 * Apply many signals in time order.
 * @param {import('./schema.js').ConceptGraph} graph
 * @param {string} userId
 * @param {object[]} signals
 */
function applySignalSequence(graph, userId, signals) {
  const ordered = [...(signals || [])].sort((a, b) => {
    const ta = Date.parse(a.at || a.timestamp || 0) || 0;
    const tb = Date.parse(b.at || b.timestamp || 0) || 0;
    return ta - tb;
  });
  const all = [];
  for (const s of ordered) {
    all.push(applySignal(graph, userId, s));
  }
  return all;
}

/**
 * Map a Jev Score (0..DEPTH_MAX_LEVEL continuous) into [0,1] depth.
 * @param {number} score
 */
function depthFromJevScore(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 0;
  return clamp01(s / DEPTH_MAX_LEVEL);
}

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function blend(prior, observation, weight) {
  const w = clamp01(weight);
  return clamp01(prior * (1 - w) + observation * w);
}

module.exports = {
  applySignal,
  applySignalSequence,
  updateBelief,
  depthFromJevScore,
  clamp01,
  blend,
};
