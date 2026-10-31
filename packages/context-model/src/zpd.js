"use strict";

const { ZPD_BANDS, depthToLevel } = require("./schema.js");

/**
 * Default half-width of the ZPD band on the continuous [0,1] depth axis.
 * Material within learnerDepth ± margin is "in_zpd".
 */
const DEFAULT_MARGIN = 0.18;

/**
 * Classify whether material at `materialDepth` sits in the learner's ZPD.
 *
 * @param {number} learnerDepth  estimated mastery on [0,1]
 * @param {number} materialDepth target difficulty / required depth on [0,1]
 * @param {{ margin?: number, confidence?: number }} [opts]
 * @returns {{ band: import('./schema.js').ZpdBand, delta: number, margin: number, learnerLevel: number, materialLevel: number }}
 */
function classifyZpdBand(learnerDepth, materialDepth, opts) {
  const learner = clamp01(learnerDepth);
  const material = clamp01(materialDepth);
  const margin =
    opts && typeof opts.margin === "number" && Number.isFinite(opts.margin)
      ? Math.max(0.05, opts.margin)
      : DEFAULT_MARGIN;

  const delta = learner - material;
  /** @type {import('./schema.js').ZpdBand} */
  let band;
  if (delta > margin) band = "too_easy";
  else if (delta < -margin) band = "too_hard";
  else band = "in_zpd";

  return {
    band,
    delta,
    margin,
    learnerLevel: depthToLevel(learner),
    materialLevel: depthToLevel(material),
  };
}

/**
 * Classify using the concept's targetDepth and the user's belief.
 *
 * @param {import('./schema.js').ConceptGraph} graph
 * @param {string} userId
 * @param {string} conceptId
 * @param {{ margin?: number, materialDepth?: number }} [opts]
 */
function classifyConceptForUser(graph, userId, conceptId, opts) {
  const belief = graph.getBelief(userId, conceptId);
  const concept = graph.concepts.get(String(conceptId));
  const materialDepth =
    opts && typeof opts.materialDepth === "number"
      ? opts.materialDepth
      : concept
        ? concept.targetDepth
        : 0.5;
  const result = classifyZpdBand(belief.depth, materialDepth, {
    margin: opts && opts.margin,
    confidence: belief.confidence,
  });
  return {
    conceptId: String(conceptId),
    belief,
    materialDepth,
    ...result,
  };
}

/**
 * Pick sources whose depth is just past the learner (in_zpd preferred).
 *
 * @param {{ id: string, conceptIds?: string[], depth: number }[]} sources
 * @param {(conceptId: string) => number} learnerDepthFor
 * @param {{ margin?: number }} [opts]
 */
function rankSourcesForZpd(sources, learnerDepthFor, opts) {
  const margin = (opts && opts.margin) || DEFAULT_MARGIN;
  return (sources || [])
    .map((source) => {
      const conceptIds = source.conceptIds || [];
      const learner =
        conceptIds.length > 0
          ? average(conceptIds.map((id) => learnerDepthFor(id)))
          : learnerDepthFor(source.id);
      const classified = classifyZpdBand(learner, source.depth, { margin });
      // Prefer in_zpd, then slight stretch (negative delta within 2*margin), then rest.
      let rank = 2;
      if (classified.band === "in_zpd") rank = 0;
      else if (classified.band === "too_hard" && classified.delta > -2 * margin)
        rank = 1;
      else if (classified.band === "too_easy") rank = 3;
      return { source, ...classified, rank, learnerDepth: learner };
    })
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return Math.abs(a.delta) - Math.abs(b.delta);
    });
}

function average(nums) {
  const list = (nums || []).filter((n) => Number.isFinite(n));
  if (!list.length) return 0;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Confusion / accuracy helpers for ZPD band evals.
 * @param {import('./schema.js').ZpdBand[]} yTrue
 * @param {import('./schema.js').ZpdBand[]} yPred
 */
function scoreZpdBands(yTrue, yPred) {
  if (!Array.isArray(yTrue) || !Array.isArray(yPred) || yTrue.length !== yPred.length) {
    throw new Error("yTrue and yPred must be equal-length arrays");
  }
  const n = yTrue.length;
  let correct = 0;
  /** @type {Record<string, {tp:number,fp:number,fn:number}>} */
  const per = {};
  for (const b of ZPD_BANDS) per[b] = { tp: 0, fp: 0, fn: 0 };

  for (let i = 0; i < n; i++) {
    const t = yTrue[i];
    const p = yPred[i];
    if (t === p) correct += 1;
    for (const b of ZPD_BANDS) {
      if (p === b && t === b) per[b].tp += 1;
      else if (p === b && t !== b) per[b].fp += 1;
      else if (p !== b && t === b) per[b].fn += 1;
    }
  }

  const f1s = [];
  /** @type {Record<string, number>} */
  const f1ByBand = {};
  for (const b of ZPD_BANDS) {
    const { tp, fp, fn } = per[b];
    const prec = tp + fp === 0 ? 0 : tp / (tp + fp);
    const rec = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = prec + rec === 0 ? 0 : (2 * prec * rec) / (prec + rec);
    f1ByBand[b] = f1;
    f1s.push(f1);
  }

  return {
    n,
    accuracy: n === 0 ? 0 : correct / n,
    macroF1: f1s.length ? f1s.reduce((a, b) => a + b, 0) / f1s.length : 0,
    f1ByBand,
    confusion: per,
  };
}

module.exports = {
  DEFAULT_MARGIN,
  classifyZpdBand,
  classifyConceptForUser,
  rankSourcesForZpd,
  scoreZpdBands,
};
