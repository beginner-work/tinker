"use strict";

const path = require("node:path");
const cm = require(path.join(
  __dirname,
  "..",
  "..",
  "..",
  "packages",
  "context-model",
  "src",
  "index.js",
));
const {
  calibrateDepthThresholds,
  predictBandFromDepth,
  confusionMatrix,
  bandDistribution,
  formatBandDiagnostics,
} = require("./calibrate-bands.js");
const { scoreBands } = require("./metrics.js");

/**
 * Replay probe history through the Tinker context model; return depth.
 *
 * @param {object} probe
 * @returns {{ depth: number, confidence: number }}
 */
function scoreProbeDepth(probe) {
  const graph = new cm.ConceptGraph();
  const uid = String(probe.userId);
  const conceptId = String(probe.conceptId);
  graph.upsertConcept({
    id: conceptId,
    slug: conceptId,
    title: conceptId,
    targetDepth: 0.55,
  });

  for (const h of probe.fullHistory || probe.history || []) {
    const cid = String(h.conceptId);
    if (!graph.concepts.has(cid)) {
      graph.upsertConcept({
        id: cid,
        slug: cid,
        title: cid,
        targetDepth: 0.55,
      });
    }
    cm.applySignal(graph, uid, {
      type: "response",
      conceptIds: [cid],
      correct: Boolean(h.correct),
      aided: Boolean(h.aided),
    });
  }

  const belief = graph.getBelief(uid, conceptId);
  return { depth: belief.depth, confidence: belief.confidence };
}

/**
 * Replay each probe's history and map depth → ZPD band.
 *
 * Band mapping uses thresholds calibrated on **train** (opts.thresholds or
 * opts.calibrateFrom). Fixed materialDepth=0.55 + DEFAULT_MARGIN collapses
 * almost all EdNet depths to too_hard — do not use that for band accuracy.
 *
 * @param {object[]} probes
 * @param {{
 *   thresholds?: { lo: number, hi: number, method?: string },
 *   calibrateFrom?: object[],
 * }} [opts]
 */
function runTinkerBaseline(probes, opts) {
  const yTrue = [];
  const yPred = [];
  const labels = [];
  const scores = [];
  const depths = [];

  let thresholds = opts && opts.thresholds;
  let calibration = null;
  if (!thresholds && opts && Array.isArray(opts.calibrateFrom)) {
    const trainRows = opts.calibrateFrom.map((probe) => {
      const scored = scoreProbeDepth(probe);
      return { depth: scored.depth, band: probe.band };
    });
    calibration = calibrateDepthThresholds(trainRows);
    thresholds = { lo: calibration.lo, hi: calibration.hi, method: calibration.method };
  }
  if (!thresholds) {
    // Safe default only when caller forgot train calibration (unit tests).
    thresholds = { lo: 0.3, hi: 0.7, method: "default-uncalibrated" };
  }

  for (const probe of probes) {
    const scored = scoreProbeDepth(probe);
    const band = predictBandFromDepth(scored.depth, thresholds);
    yTrue.push(probe.band);
    yPred.push(band);
    depths.push(scored.depth);

    if (typeof probe.nextCorrect === "boolean") {
      labels.push(probe.nextCorrect ? 1 : 0);
      // Higher depth → higher P(correct) — AUC uses continuous depth, not bands.
      scores.push(scored.depth);
    }
  }

  const bandScore = scoreBands(yTrue, yPred);
  return {
    yTrue,
    yPred,
    labels,
    scores,
    depths,
    thresholds,
    calibration,
    confusion: confusionMatrix(yTrue, yPred),
    trueDistribution: bandDistribution(yTrue),
    predDistribution: bandDistribution(yPred),
    bandScore,
    diagnostics: formatBandDiagnostics({
      yTrue,
      yPred,
      label: "tinker-context-model",
    }),
    method: "tinker-context-model",
  };
}

module.exports = {
  scoreProbeDepth,
  runTinkerBaseline,
};
