"use strict";

const { loadLabeledProbes } = require("./sample.js");
const { runTinkerBaseline } = require("./tinker-baseline.js");
const { runBktBaseline } = require("./bkt.js");
const { runClaudeBaseline } = require("./claude-baseline.js");
const { runJevClaudeBaseline } = require("./jev-claude-baseline.js");
const { scoreBands, rocAuc } = require("./metrics.js");
const { splitByKey, activeSplit, splitSeed } = require("../../lib/splits.js");
const { appendExperiment, readTestEvalCount } = require("../../lib/experiment-log.js");
const { loadEvalConfig } = require("../../config/load.js");
const {
  fitAndScore,
  probsFromJevScore,
} = require("../../lib/classical-on-jev.js");

function summarize(name, run) {
  if (run.skipped) {
    return { name, skipped: true, reason: run.reason };
  }
  const bands = scoreBands(run.yTrue, run.yPred);
  const auc =
    run.labels && run.labels.length
      ? rocAuc(run.labels, run.scores)
      : null;
  return {
    name,
    skipped: false,
    n: bands.n,
    accuracy: bands.accuracy,
    macroF1: bands.macroF1,
    f1ByBand: bands.f1ByBand,
    nextResponseAuc: auc,
    version: run.version || null,
  };
}

/**
 * Baseline EdNet ZPD run for the iteration loop.
 * Default split: **dev**. Held-out **test** only when EVAL_SPLIT=test / --test.
 */
async function runEdnetZpd(opts) {
  const env = (opts && opts.env) || process.env;
  const argv = (opts && opts.argv) || process.argv.slice(2);
  const pack = (opts && opts.config) || loadEvalConfig({ env });
  const seed = splitSeed(env);
  const splitName = activeSplit(env, argv);

  const labeled = loadLabeledProbes();
  const allProbes = labeled.probes || [];
  const splits = splitByKey(
    allProbes,
    (p) => `${p.userId}::${p.conceptId}`,
    { seed },
  );
  const probes = splits[splitName] || [];
  const trainProbes = splits.train || [];

  const keyedLimit =
    (opts && opts.claudeLimit) || Math.min(30, probes.length);
  const tinker = runTinkerBaseline(probes);
  const bkt = runBktBaseline(probes);
  const claude = await runClaudeBaseline(probes, {
    env,
    fetchFn: opts && opts.fetchFn,
    config: pack,
    limit: keyedLimit,
  });
  const jevClaude =
    opts && opts.skipJevClaude
      ? {
          skipped: true,
          reason: "skipJevClaude",
          yTrue: [],
          yPred: [],
          labels: [],
          scores: [],
        }
      : await runJevClaudeBaseline(probes, {
          env,
          fetchFn: opts && opts.fetchFn,
          config: pack,
          limit: (opts && opts.jevClaudeLimit) || keyedLimit,
        });

  // Stretch: classical model on synthetic/proxy "Jev-like" probs from depth
  // bins when real Jev vectors are absent (offline). Real Jev probs plug in
  // the same fitAndScore path when provided via opts.jevProbRows.
  let classical = null;
  if (!opts || opts.includeClassical !== false) {
    const toRow = (p, predDepth) => {
      // Proxy 5-level distribution peaked at depthToLevel (stand-in until Jev runs).
      const level = Math.round(predDepth * 4);
      const probs = [0, 0, 0, 0, 0];
      probs[Math.min(4, Math.max(0, level))] = 1;
      return { probs, band: p.band };
    };
    const trainDepths = runTinkerBaseline(trainProbes);
    const evalDepths = tinker;
    const trainRows =
      (opts && opts.jevProbRows && opts.jevProbRows.train) ||
      trainProbes.map((p, i) => toRow(p, trainDepths.scores[i] || 0));
    const evalRows =
      (opts && opts.jevProbRows && opts.jevProbRows.eval) ||
      probes.map((p, i) => toRow(p, evalDepths.scores[i] || 0));
    classical = fitAndScore(trainRows, evalRows, { epochs: 40 });
  }

  const baselines = {
    tinker: summarize("tinker-context-model", tinker),
    bkt: summarize("bkt", { ...bkt, skipped: false }),
    claude: summarize("claude-band", claude),
    jevClaude: summarize("jev+claude", jevClaude),
    classicalOnJev: classical
      ? {
          name: "softmax-on-jev-probs",
          stretch: true,
          skipped: false,
          n: classical.nEval,
          accuracy: classical.accuracy,
          nTrain: classical.nTrain,
        }
      : null,
  };

  const scorePayload = {
    tinkerAccuracy: baselines.tinker.accuracy,
    tinkerMacroF1: baselines.tinker.macroF1,
    bktAccuracy: baselines.bkt.accuracy,
    bktMacroF1: baselines.bkt.macroF1,
    bktAuc: baselines.bkt.nextResponseAuc,
    claudeAccuracy: baselines.claude.skipped ? null : baselines.claude.accuracy,
    claudeMacroF1: baselines.claude.skipped ? null : baselines.claude.macroF1,
    claudeAuc: baselines.claude.skipped ? null : baselines.claude.nextResponseAuc,
    jevClaudeAccuracy: baselines.jevClaude.skipped
      ? null
      : baselines.jevClaude.accuracy,
    jevClaudeMacroF1: baselines.jevClaude.skipped
      ? null
      : baselines.jevClaude.macroF1,
    jevClaudeAuc: baselines.jevClaude.skipped
      ? null
      : baselines.jevClaude.nextResponseAuc,
    classicalAccuracy: classical ? classical.accuracy : null,
    n: probes.length,
  };

  const logResult =
    opts && opts.skipLog
      ? { wrote: false, testEvalCount: readTestEvalCount() }
      : appendExperiment({
          version: pack.version,
          benchmark: "ednet-zpd",
          split: splitName,
          devScore: splitName === "test" ? null : scorePayload,
          testScore: splitName === "test" ? scorePayload : null,
          dryRun: Boolean(opts && opts.dryRun),
          meta: {
            source: labeled.source,
            seed,
            splitSizes: {
              train: splits.train.length,
              dev: splits.dev.length,
              test: splits.test.length,
            },
            configSource: pack.source,
            agentModeling: pack.agentModeling,
          },
        });

  return {
    baseline: true,
    agentModeling: false,
    version: pack.version,
    configSource: pack.source,
    split: splitName,
    seed,
    splitSizes: {
      train: splits.train.length,
      dev: splits.dev.length,
      test: splits.test.length,
    },
    source: labeled.source,
    note: labeled.note || null,
    config: labeled.config,
    probeCount: probes.length,
    eventCount: (labeled.events || []).length,
    baselines,
    experimentLog: {
      wrote: logResult.wrote,
      testEvalCount: logResult.testEvalCount,
    },
    goalsNote:
      "v0 baseline for an iteration loop. Numeric goals stay private. Dev is the tuning split; test is rare.",
  };
}

module.exports = {
  runEdnetZpd,
  summarize,
  probsFromJevScore,
};
