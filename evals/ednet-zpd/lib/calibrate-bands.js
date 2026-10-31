"use strict";

/**
 * Map continuous learner depth → ZPD band with thresholds calibrated on
 * **train only**. Never fit on dev/test.
 *
 * Ordered axis (low → high depth): too_hard | in_zpd | too_easy
 * Cuts: depth < lo → too_hard; lo <= depth < hi → in_zpd; depth >= hi → too_easy
 */

const { scoreBands } = require("./metrics.js");

const ORDERED_BANDS = Object.freeze(["too_hard", "in_zpd", "too_easy"]);

/**
 * @param {string[]} labels
 * @returns {Record<string, number>}
 */
function bandDistribution(labels) {
  /** @type {Record<string, number>} */
  const out = { too_easy: 0, in_zpd: 0, too_hard: 0 };
  for (const b of labels || []) {
    if (Object.prototype.hasOwnProperty.call(out, b)) out[b] += 1;
    else out[b] = (out[b] || 0) + 1;
  }
  return out;
}

/**
 * Full 3×3 counts: rows = true, cols = predicted.
 * @param {string[]} yTrue
 * @param {string[]} yPred
 */
function confusionMatrix(yTrue, yPred) {
  /** @type {Record<string, Record<string, number>>} */
  const matrix = {};
  for (const t of ORDERED_BANDS) {
    matrix[t] = { too_easy: 0, in_zpd: 0, too_hard: 0 };
  }
  const n = Math.min(yTrue.length, yPred.length);
  for (let i = 0; i < n; i++) {
    const t = yTrue[i];
    const p = yPred[i];
    if (!matrix[t]) matrix[t] = { too_easy: 0, in_zpd: 0, too_hard: 0 };
    if (matrix[t][p] == null) matrix[t][p] = 0;
    matrix[t][p] += 1;
  }
  return matrix;
}

/**
 * @param {number} depth
 * @param {{ lo: number, hi: number }} thresholds
 */
function predictBandFromDepth(depth, thresholds) {
  const d = Number(depth);
  const lo = thresholds.lo;
  const hi = thresholds.hi;
  if (!(Number.isFinite(d) && Number.isFinite(lo) && Number.isFinite(hi))) {
    return "in_zpd";
  }
  if (d < lo) return "too_hard";
  if (d < hi) return "in_zpd";
  return "too_easy";
}

/**
 * Brute-force two cut points on train depths. Objective: macro-F1, then accuracy.
 *
 * @param {{ depth: number, band: string }[]} trainRows
 * @param {{ maxCandidates?: number }} [opts]
 * @returns {{ lo: number, hi: number, train: ReturnType<typeof scoreBands>, method: string }}
 */
function calibrateDepthThresholds(trainRows, opts) {
  const rows = (trainRows || []).filter(
    (r) => r && Number.isFinite(Number(r.depth)) && r.band,
  );
  if (rows.length < 3) {
    return {
      lo: 0.3,
      hi: 0.7,
      method: "default-uncalibrated",
      train: scoreBands(
        rows.map((r) => r.band),
        rows.map((r) => predictBandFromDepth(r.depth, { lo: 0.3, hi: 0.7 })),
      ),
    };
  }

  const unique = [
    ...new Set(rows.map((r) => Number(Number(r.depth).toFixed(4)))),
  ].sort((a, b) => a - b);

  // Cap grid size for large train sets (still train-only).
  const maxCand = (opts && opts.maxCandidates) || 80;
  let cand = unique;
  if (cand.length > maxCand) {
    const step = (cand.length - 1) / (maxCand - 1);
    cand = Array.from({ length: maxCand }, (_, i) => cand[Math.round(i * step)]);
    cand = [...new Set(cand)].sort((a, b) => a - b);
  }

  let best = null;
  for (let i = 0; i < cand.length; i++) {
    for (let j = i + 1; j < cand.length; j++) {
      const lo = cand[i];
      const hi = cand[j];
      const yTrue = rows.map((r) => r.band);
      const yPred = rows.map((r) => predictBandFromDepth(r.depth, { lo, hi }));
      const scored = scoreBands(yTrue, yPred);
      if (
        !best ||
        scored.macroF1 > best.train.macroF1 + 1e-12 ||
        (Math.abs(scored.macroF1 - best.train.macroF1) <= 1e-12 &&
          scored.accuracy > best.train.accuracy)
      ) {
        best = { lo, hi, train: scored, method: "train-depth-cuts" };
      }
    }
  }

  return (
    best || {
      lo: 0.3,
      hi: 0.7,
      method: "default-uncalibrated",
      train: scoreBands(
        rows.map((r) => r.band),
        rows.map((r) => predictBandFromDepth(r.depth, { lo: 0.3, hi: 0.7 })),
      ),
    }
  );
}

/**
 * Pretty-print confusion + distributions for CI logs.
 * @param {{ yTrue: string[], yPred: string[], label?: string }} args
 */
function formatBandDiagnostics(args) {
  const yTrue = args.yTrue || [];
  const yPred = args.yPred || [];
  const label = args.label || "bands";
  const matrix = confusionMatrix(yTrue, yPred);
  const trueDist = bandDistribution(yTrue);
  const predDist = bandDistribution(yPred);
  const lines = [
    `[${label}] n=${yTrue.length}`,
    `[${label}] true distribution: ${JSON.stringify(trueDist)}`,
    `[${label}] pred distribution: ${JSON.stringify(predDist)}`,
    `[${label}] confusion (rows=true, cols=pred):`,
  ];
  const header = ["true\\pred", ...ORDERED_BANDS].join("\t");
  lines.push(header);
  for (const t of ORDERED_BANDS) {
    lines.push(
      [t, ...ORDERED_BANDS.map((p) => String((matrix[t] && matrix[t][p]) || 0))].join(
        "\t",
      ),
    );
  }
  return lines.join("\n");
}

module.exports = {
  ORDERED_BANDS,
  bandDistribution,
  confusionMatrix,
  predictBandFromDepth,
  calibrateDepthThresholds,
  formatBandDiagnostics,
};
