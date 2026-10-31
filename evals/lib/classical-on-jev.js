"use strict";

/**
 * STRETCH: downstream classical model on Jev probability features.
 *
 * Multinomial logistic regression (softmax) trained on train-split rows of
 * shape { probs: number[], band: 'too_easy'|'in_zpd'|'too_hard' }.
 * No API keys. Used when Jev probability vectors are available; otherwise
 * unit tests feed synthetic probs.
 */

const BANDS = ["too_easy", "in_zpd", "too_hard"];

function zeros(n) {
  return Array.from({ length: n }, () => 0);
}

function softmax(logits) {
  const max = Math.max(...logits);
  const exps = logits.map((z) => Math.exp(z - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

/**
 * @param {{ probs: number[], band: string }[]} rows
 * @param {{ epochs?: number, lr?: number, l2?: number, seed?: number }} [opts]
 */
function trainSoftmax(rows, opts) {
  const epochs = (opts && opts.epochs) || 80;
  const lr = (opts && opts.lr) || 0.2;
  const l2 = (opts && opts.l2) || 0.001;
  const dim = (rows[0] && rows[0].probs.length) || 0;
  if (!dim || !rows.length) {
    return { dim: 0, weights: [], bias: zeros(BANDS.length), bands: BANDS.slice() };
  }

  // weights[class][feature]
  const weights = BANDS.map(() => zeros(dim));
  const bias = zeros(BANDS.length);

  for (let epoch = 0; epoch < epochs; epoch++) {
    for (const row of rows) {
      const x = row.probs;
      const y = BANDS.indexOf(row.band);
      if (y < 0) continue;
      const logits = BANDS.map((_, c) => {
        let s = bias[c];
        for (let j = 0; j < dim; j++) s += weights[c][j] * x[j];
        return s;
      });
      const p = softmax(logits);
      for (let c = 0; c < BANDS.length; c++) {
        const err = p[c] - (c === y ? 1 : 0);
        bias[c] -= lr * err;
        for (let j = 0; j < dim; j++) {
          weights[c][j] -= lr * (err * x[j] + l2 * weights[c][j]);
        }
      }
    }
  }

  return { dim, weights, bias, bands: BANDS.slice() };
}

function predict(model, probs) {
  if (!model || !model.dim) return "in_zpd";
  const logits = model.bands.map((_, c) => {
    let s = model.bias[c];
    for (let j = 0; j < model.dim; j++) {
      s += model.weights[c][j] * (probs[j] || 0);
    }
    return s;
  });
  const p = softmax(logits);
  let best = 0;
  for (let i = 1; i < p.length; i++) if (p[i] > p[best]) best = i;
  return model.bands[best];
}

/**
 * @param {{ probs: number[], band: string }[]} trainRows
 * @param {{ probs: number[], band: string }[]} evalRows
 */
function fitAndScore(trainRows, evalRows, opts) {
  const model = trainSoftmax(trainRows, opts);
  const yTrue = [];
  const yPred = [];
  for (const row of evalRows || []) {
    yTrue.push(row.band);
    yPred.push(predict(model, row.probs));
  }
  let correct = 0;
  for (let i = 0; i < yTrue.length; i++) if (yTrue[i] === yPred[i]) correct += 1;
  return {
    method: "softmax-on-jev-probs",
    stretch: true,
    nTrain: trainRows.length,
    nEval: evalRows.length,
    accuracy: evalRows.length ? correct / evalRows.length : null,
    model: { dim: model.dim, bands: model.bands },
    yTrue,
    yPred,
  };
}

/**
 * Build a dense probability vector from a Jev Score answer.
 * Missing levels → 0.
 * @param {Record<string, number>} probabilities
 * @param {number} maxLevel
 */
function probsFromJevScore(probabilities, maxLevel) {
  const out = [];
  for (let i = 0; i <= maxLevel; i++) {
    const v = probabilities && probabilities[String(i)];
    out.push(typeof v === "number" ? v : 0);
  }
  return out;
}

module.exports = {
  BANDS,
  trainSoftmax,
  predict,
  fitAndScore,
  probsFromJevScore,
  softmax,
};
