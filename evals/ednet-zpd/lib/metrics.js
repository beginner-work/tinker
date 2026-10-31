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
 * ROC AUC for binary labels with scores (higher = more likely positive).
 * @param {number[]} labels 0/1
 * @param {number[]} scores
 */
function rocAuc(labels, scores) {
  if (!labels.length || labels.length !== scores.length) return null;
  const pairs = labels.map((y, i) => ({ y: y ? 1 : 0, s: Number(scores[i]) || 0 }));
  pairs.sort((a, b) => a.s - b.s);
  const pos = pairs.filter((p) => p.y === 1).length;
  const neg = pairs.length - pos;
  if (pos === 0 || neg === 0) return null;

  // Mann-Whitney U / Wilcoxon-Mann-Whitney statistic
  let rankSum = 0;
  let i = 0;
  while (i < pairs.length) {
    let j = i;
    while (j < pairs.length && pairs[j].s === pairs[i].s) j += 1;
    const avgRank = (i + 1 + j) / 2; // 1-based ranks
    for (let k = i; k < j; k++) {
      if (pairs[k].y === 1) rankSum += avgRank;
    }
    i = j;
  }
  const u = rankSum - (pos * (pos + 1)) / 2;
  return u / (pos * neg);
}

function scoreBands(yTrue, yPred) {
  return cm.scoreZpdBands(yTrue, yPred);
}

module.exports = {
  rocAuc,
  scoreBands,
  scoreZpdBands: cm.scoreZpdBands,
};
