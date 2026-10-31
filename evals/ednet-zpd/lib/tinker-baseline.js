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

/**
 * Replay each probe's history through the Tinker context model and
 * classify the probe concept's ZPD band.
 *
 * @param {object[]} probes
 */
function runTinkerBaseline(probes) {
  const yTrue = [];
  const yPred = [];
  const labels = [];
  const scores = [];

  /** Cache graphs per user+history fingerprint would be ideal; replay is fine for small samples. */
  for (const probe of probes) {
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
        graph.upsertConcept({ id: cid, slug: cid, title: cid, targetDepth: 0.55 });
      }
      cm.applySignal(graph, uid, {
        type: "response",
        conceptIds: [cid],
        correct: Boolean(h.correct),
        aided: Boolean(h.aided),
      });
    }

    const classified = cm.classifyConceptForUser(graph, uid, conceptId, {
      materialDepth: 0.55,
    });
    yTrue.push(probe.band);
    yPred.push(classified.band);

    if (typeof probe.nextCorrect === "boolean") {
      labels.push(probe.nextCorrect ? 1 : 0);
      // Higher depth → higher P(correct)
      scores.push(graph.getBelief(uid, conceptId).depth);
    }
  }

  return { yTrue, yPred, labels, scores, method: "tinker-context-model" };
}

module.exports = { runTinkerBaseline };
