"use strict";

const { loadCasesWithKey } = require("./load.js");
const { runTinkerCase, runClaudeCase } = require("./runners.js");
const { splitByKey, activeSplit, splitSeed } = require("../../lib/splits.js");
const { appendExperiment, readTestEvalCount } = require("../../lib/experiment-log.js");
const { loadEvalConfig } = require("../../config/load.js");
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

function hitRate(rows) {
  const usable = rows.filter((r) => !r.skipped);
  if (!usable.length) return null;
  const hits = usable.filter((r) => r.hit).length;
  return hits / usable.length;
}

/**
 * INTERNAL source-ZPD baseline. Default split: dev.
 */
async function runSourceZpd(opts) {
  const env = (opts && opts.env) || process.env;
  const argv = (opts && opts.argv) || process.argv.slice(2);
  const pack = (opts && opts.config) || loadEvalConfig({ env });
  const seed = splitSeed(env);
  const splitName = activeSplit(env, argv);

  const allCases = loadCasesWithKey();
  const splits = splitByKey(allCases, (c) => c.id, { seed });
  const cases = splits[splitName] || [];

  const useJev =
    cm.resolveJevConfig(env).available && opts && opts.useJev !== false;

  const tinkerRows = [];
  const claudeRows = [];

  for (const c of cases) {
    const tinker = await runTinkerCase(c, {
      useJev: false,
      env,
      fetchFn: opts && opts.fetchFn,
      config: pack,
    });
    tinkerRows.push({ id: c.id, multiSession: !!c.multiSession, ...tinker });

    if (useJev) {
      const tinkerJev = await runTinkerCase(c, {
        useJev: true,
        env,
        fetchFn: opts && opts.fetchFn,
        config: pack,
      });
      tinkerRows.push({
        id: `${c.id}+jev`,
        multiSession: !!c.multiSession,
        ...tinkerJev,
      });
    }

    const claude = await runClaudeCase(c, {
      env,
      fetchFn: opts && opts.fetchFn,
      config: pack,
    });
    claudeRows.push({ id: c.id, multiSession: !!c.multiSession, ...claude });
  }

  const scorePayload = {
    tinkerHitRate: hitRate(tinkerRows.filter((r) => !String(r.id).endsWith("+jev"))),
    jevHitRate: hitRate(tinkerRows.filter((r) => String(r.id).endsWith("+jev"))),
    claudeHitRate: hitRate(claudeRows),
    n: cases.length,
  };

  const logResult =
    opts && opts.skipLog
      ? { wrote: false, testEvalCount: readTestEvalCount() }
      : appendExperiment({
          version: pack.version,
          benchmark: "source-zpd",
          split: splitName,
          devScore: splitName === "test" ? null : scorePayload,
          testScore: splitName === "test" ? scorePayload : null,
          dryRun: Boolean(opts && opts.dryRun),
          meta: {
            internal: true,
            seed,
            splitSizes: {
              train: splits.train.length,
              dev: splits.dev.length,
              test: splits.test.length,
            },
            configSource: pack.source,
            agentModeling: false,
          },
        });

  return {
    internal: true,
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
    caseCount: cases.length,
    tinker: {
      hitRate: scorePayload.tinkerHitRate,
      jevHitRate: scorePayload.jevHitRate,
      rows: tinkerRows,
    },
    claude: {
      skipped: claudeRows.every((r) => r.skipped),
      reason: claudeRows.find((r) => r.skipped)?.reason || null,
      hitRate: scorePayload.claudeHitRate,
      rows: claudeRows,
    },
    experimentLog: {
      wrote: logResult.wrote,
      testEvalCount: logResult.testEvalCount,
    },
    goalsNote:
      "Internal baseline. Iteration reads dev only; test is rare and counted.",
  };
}

module.exports = { runSourceZpd, hitRate };
