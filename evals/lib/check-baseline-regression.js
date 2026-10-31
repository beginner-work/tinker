#!/usr/bin/env node
/**
 * Fail CI when EdNet ZPD band accuracy or macro-F1 on the **dev** split
 * drops below the last recorded baseline in experiments.jsonl.
 *
 * Tolerance (absolute, on [0,1] scores):
 *   EVAL_BASELINE_TOLERANCE  default 0.02  (2 percentage points)
 *
 * Compared systems (when present / not skipped in the report):
 *   tinker, bkt, claude, jevClaude  → accuracy + macroF1
 *
 * Usage:
 *   node evals/lib/check-baseline-regression.js \
 *     --report evals/ednet-zpd/last-report.json \
 *     [--baseline evals/experiment-log/experiments.jsonl] \
 *     [--benchmark ednet-zpd]
 *
 * Exit 0: pass (or no prior baseline / nothing comparable)
 * Exit 1: regression beyond tolerance
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readExperiments } = require("./experiment-log.js");

const DEFAULT_TOLERANCE = 0.02;
const SYSTEMS = [
  { key: "tinker", accuracy: "accuracy", macroF1: "macroF1", label: "tinker" },
  { key: "bkt", accuracy: "accuracy", macroF1: "macroF1", label: "bkt" },
  { key: "claude", accuracy: "accuracy", macroF1: "macroF1", label: "claude" },
  {
    key: "jevClaude",
    accuracy: "accuracy",
    macroF1: "macroF1",
    label: "jev+claude",
  },
];

function parseArgs(argv) {
  const out = {
    report: null,
    baseline: path.join(__dirname, "..", "experiment-log", "experiments.jsonl"),
    benchmark: "ednet-zpd",
    split: "dev",
    tolerance: Number(process.env.EVAL_BASELINE_TOLERANCE || DEFAULT_TOLERANCE),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--report") out.report = argv[++i];
    else if (a === "--baseline") out.baseline = argv[++i];
    else if (a === "--benchmark") out.benchmark = argv[++i];
    else if (a === "--split") out.split = argv[++i];
    else if (a === "--tolerance") out.tolerance = Number(argv[++i]);
  }
  return out;
}

function lastBaselineRow(rows, benchmark, split) {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r && r.benchmark === benchmark && r.split === split && r.devScore) {
      return r;
    }
  }
  return null;
}

function scoreFromReport(report, system) {
  const block = report && report.baselines && report.baselines[system.key];
  if (!block || block.skipped) return null;
  const accuracy = Number(block[system.accuracy]);
  const macroF1 = Number(block[system.macroF1]);
  if (!Number.isFinite(accuracy) && !Number.isFinite(macroF1)) return null;
  return {
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
    macroF1: Number.isFinite(macroF1) ? macroF1 : null,
  };
}

function scoreFromDevScore(devScore, system) {
  if (!devScore) return null;
  // Historical rows used flat keys: tinkerAccuracy / tinkerMacroF1 / bktAccuracy
  const accKeys = [
    `${system.key}Accuracy`,
    system.key === "jevClaude" ? "jevClaudeAccuracy" : null,
    system.key === "tinker" ? "tinkerAccuracy" : null,
    system.key === "bkt" ? "bktAccuracy" : null,
    system.key === "claude" ? "claudeAccuracy" : null,
  ].filter(Boolean);
  const f1Keys = [
    `${system.key}MacroF1`,
    system.key === "jevClaude" ? "jevClaudeMacroF1" : null,
    system.key === "tinker" ? "tinkerMacroF1" : null,
    system.key === "bkt" ? "bktMacroF1" : null,
    system.key === "claude" ? "claudeMacroF1" : null,
  ].filter(Boolean);

  let accuracy = null;
  let macroF1 = null;
  for (const k of accKeys) {
    if (devScore[k] != null && Number.isFinite(Number(devScore[k]))) {
      accuracy = Number(devScore[k]);
      break;
    }
  }
  for (const k of f1Keys) {
    if (devScore[k] != null && Number.isFinite(Number(devScore[k]))) {
      macroF1 = Number(devScore[k]);
      break;
    }
  }
  if (accuracy == null && macroF1 == null) return null;
  return { accuracy, macroF1 };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.report) {
    console.error("check-baseline-regression: --report required");
    process.exit(2);
  }
  const report = JSON.parse(fs.readFileSync(args.report, "utf8"));
  if (report.split && report.split !== args.split) {
    console.error(
      `check-baseline-regression: report split=${report.split} (gate is ${args.split}-only); skipping`,
    );
    process.exit(0);
  }

  let rows = [];
  if (fs.existsSync(args.baseline)) {
    const text = fs.readFileSync(args.baseline, "utf8");
    rows = text
      .split(/\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } else {
    rows = readExperiments();
  }

  const reportSource = report.source || (report.meta && report.meta.source) || null;

  // Callers should pass the *pre-run* snapshot of experiments.jsonl (CI copies
  // HEAD before appending). Prefer the last row with the same data source so
  // synthetic CI fixtures are not gated against real EdNet baselines (and
  // vice versa).
  let baselineRow = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (!r || r.benchmark !== args.benchmark || r.split !== args.split || !r.devScore) {
      continue;
    }
    const rowSource = (r.meta && r.meta.source) || null;
    if (reportSource && rowSource && reportSource !== rowSource) continue;
    baselineRow = r;
    break;
  }
  if (!baselineRow) {
    console.log(
      JSON.stringify({
        ok: true,
        reason: reportSource
          ? "no_prior_baseline_for_source"
          : "no_prior_baseline",
        source: reportSource,
        tolerance: args.tolerance,
        benchmark: args.benchmark,
        split: args.split,
      }),
    );
    process.exit(0);
  }

  const failures = [];
  const comparisons = [];
  for (const system of SYSTEMS) {
    const current = scoreFromReport(report, system);
    const baseline = scoreFromDevScore(baselineRow.devScore, system);
    if (!current || !baseline) {
      comparisons.push({
        system: system.label,
        skipped: true,
        reason: !current ? "no_current" : "no_baseline_metric",
      });
      continue;
    }
    const row = { system: system.label, current, baseline, drops: [] };
    if (
      current.accuracy != null &&
      baseline.accuracy != null &&
      current.accuracy + 1e-12 < baseline.accuracy - args.tolerance
    ) {
      const drop = {
        metric: "accuracy",
        current: current.accuracy,
        baseline: baseline.accuracy,
        floor: baseline.accuracy - args.tolerance,
      };
      row.drops.push(drop);
      failures.push({ system: system.label, ...drop });
    }
    if (
      current.macroF1 != null &&
      baseline.macroF1 != null &&
      current.macroF1 + 1e-12 < baseline.macroF1 - args.tolerance
    ) {
      const drop = {
        metric: "macroF1",
        current: current.macroF1,
        baseline: baseline.macroF1,
        floor: baseline.macroF1 - args.tolerance,
      };
      row.drops.push(drop);
      failures.push({ system: system.label, ...drop });
    }
    comparisons.push(row);
  }

  const payload = {
    ok: failures.length === 0,
    tolerance: args.tolerance,
    benchmark: args.benchmark,
    split: args.split,
    baselineAt: baselineRow.at,
    baselineVersion: baselineRow.version,
    comparisons,
    failures,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (failures.length) {
    console.error(
      `Baseline regression: ${failures.length} metric(s) below last recorded baseline minus tolerance ${args.tolerance}`,
    );
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_TOLERANCE,
  SYSTEMS,
  lastBaselineRow,
  scoreFromReport,
  scoreFromDevScore,
  parseArgs,
};
