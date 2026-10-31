"use strict";

/**
 * Classic Bayesian Knowledge Tracing (Corbett & Anderson).
 * Per-skill Bernoulli latent mastery; used as a published-style reference
 * baseline that runs with no API keys.
 */

const DEFAULTS = Object.freeze({
  pL0: 0.1,
  pT: 0.1,
  pG: 0.2,
  pS: 0.1,
});

/**
 * @param {{ pL0?: number, pT?: number, pG?: number, pS?: number }} [params]
 */
function createBkt(params) {
  const p = { ...DEFAULTS, ...(params || {}) };
  /** @type {Map<string, number>} skill -> P(L) */
  const state = new Map();

  function get(skill) {
    const k = String(skill);
    return state.has(k) ? state.get(k) : p.pL0;
  }

  function set(skill, value) {
    state.set(String(skill), Math.min(0.999, Math.max(0.001, value)));
  }

  /** Probability of a correct response given current mastery. */
  function predictCorrect(skill) {
    const pL = get(skill);
    return pL * (1 - p.pS) + (1 - pL) * p.pG;
  }

  /** Update after observing correct (true/false). */
  function update(skill, correct) {
    const pL = get(skill);
    let pLGivenObs;
    if (correct) {
      const pCorrect = pL * (1 - p.pS) + (1 - pL) * p.pG;
      pLGivenObs = (pL * (1 - p.pS)) / pCorrect;
    } else {
      const pWrong = pL * p.pS + (1 - pL) * (1 - p.pG);
      pLGivenObs = (pL * p.pS) / pWrong;
    }
    const pLNext = pLGivenObs + (1 - pLGivenObs) * p.pT;
    set(skill, pLNext);
    return pLNext;
  }

  /**
   * Map mastery to a ZPD band relative to a "working" threshold.
   * High mastery → too_easy; mid → in_zpd; low → too_hard.
   */
  function band(skill, opts) {
    const high = (opts && opts.high) || 0.7;
    const low = (opts && opts.low) || 0.3;
    const pL = get(skill);
    if (pL >= high) return "too_easy";
    if (pL <= low) return "too_hard";
    return "in_zpd";
  }

  return { get, set, predictCorrect, update, band, params: p, state };
}

/**
 * Run BKT over labeled probes chronologically.
 * Each probe: { userId, conceptId, history: [{conceptId, correct}], band }
 *
 * @param {object[]} probes
 */
function runBktBaseline(probes) {
  /** @type {Map<string, ReturnType<typeof createBkt>>} */
  const byUser = new Map();
  const yTrue = [];
  const yPred = [];
  const labels = [];
  const scores = [];

  for (const probe of probes) {
    const uid = String(probe.userId);
    if (!byUser.has(uid)) byUser.set(uid, createBkt());
    const model = byUser.get(uid);

    for (const ev of probe.history || []) {
      model.update(ev.conceptId, Boolean(ev.correct));
    }

    const conceptId = probe.conceptId;
    yTrue.push(probe.band);
    yPred.push(model.band(conceptId));
    if (typeof probe.nextCorrect === "boolean") {
      labels.push(probe.nextCorrect ? 1 : 0);
      scores.push(model.predictCorrect(conceptId));
    }
  }

  return { yTrue, yPred, labels, scores };
}

module.exports = {
  DEFAULTS,
  createBkt,
  runBktBaseline,
};
