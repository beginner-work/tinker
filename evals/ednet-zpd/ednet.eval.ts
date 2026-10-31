/**
 * Braintrust eval for EdNet ZPD band accuracy.
 * Offline Tinker + BKT always score. Claude/Jev keyed baselines live in run.js
 * (AI Gateway). Tinker depth→band cuts are calibrated on train only.
 */
import { Eval } from "braintrust";
import { createRequire } from "node:module";

const require = createRequire(__filename);
const { loadLabeledProbes } = require("./lib/sample.js");
const { runTinkerBaseline } = require("./lib/tinker-baseline.js");
const { runBktBaseline } = require("./lib/bkt.js");
const { scoreBands } = require("./lib/metrics.js");
const { splitByKey, splitSeed } = require("../lib/splits.js");

const labeled = loadLabeledProbes();
const allProbes = labeled.probes || [];
const splits = splitByKey(
  allProbes,
  (p: { userId: string; conceptId: string }) => `${p.userId}::${p.conceptId}`,
  { seed: splitSeed(process.env) },
);
const trainProbes = splits.train || [];
const probes = (splits.dev || allProbes).slice(0, 80);

const rows = probes.map((p: {
  userId: string;
  conceptId: string;
  band: string;
  history: unknown[];
  fullHistory?: unknown[];
  nextCorrect?: boolean;
}, i: number) => ({
  input: {
    index: i,
    userId: p.userId,
    conceptId: p.conceptId,
  },
  expected: { band: p.band },
  metadata: { probe: p },
}));

Eval("tinker-ednet-zpd", {
  experimentName: "ednet-zpd-bands",
  maxConcurrency: 1,
  metadata: {
    source: labeled.source,
    probeCount: probes.length,
    config: labeled.config,
    note: labeled.note || null,
  },
  data: () => rows,
  task: async (input) => {
    const probe = probes[input.index];
    const tinker = runTinkerBaseline([probe], { calibrateFrom: trainProbes });
    const bkt = runBktBaseline([probe]);
    return {
      tinkerBand: tinker.yPred[0],
      bktBand: bkt.yPred[0],
    };
  },
  scores: [
    (args) => ({
      name: "TinkerBandMatch",
      score: args.expected?.band === args.output?.tinkerBand ? 1 : 0,
    }),
    (args) => ({
      name: "BktBandMatch",
      score: args.expected?.band === args.output?.bktBand ? 1 : 0,
    }),
  ],
});

const tinkerAll = runTinkerBaseline(probes, { calibrateFrom: trainProbes });
const bktAll = runBktBaseline(probes);
console.error(
  "[ednet-zpd] offline",
  JSON.stringify({
    source: labeled.source,
    tinker: scoreBands(tinkerAll.yTrue, tinkerAll.yPred),
    bkt: scoreBands(bktAll.yTrue, bktAll.yPred),
    thresholds: tinkerAll.thresholds,
  }),
);
