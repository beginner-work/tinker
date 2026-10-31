"use strict";

/**
 * v0 Jev + Claude baseline (no agent modeling).
 *
 * 1. Jev Score (AI Gateway, pinned model in evals) → learner depth
 * 2. Claude band classifier with history + Jev depth/probs in the prompt
 * 3. Local ZPD classify from Jev depth as a structured fallback if Claude skips
 */

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
  loadEvalConfig,
  renderTemplate,
  jevDepthQuestion,
} = require("../../config/load.js");
const { callClaudeMessages } = require("../../lib/claude-client.js");
const { parseBand, formatHistory } = require("./claude-baseline.js");

const MATERIAL_DEPTH = 0.55;

function formatHistoryState(probe) {
  const rows = (probe.fullHistory || probe.history || []).slice(-40);
  return {
    conceptId: String(probe.conceptId),
    responses: rows.map((h) => ({
      conceptId: String(h.conceptId),
      correct: Boolean(h.correct),
      aided: Boolean(h.aided),
    })),
  };
}

/**
 * @param {object} probe
 * @param {{ fetchFn?: typeof fetch, env?: NodeJS.ProcessEnv, config?: object }} [opts]
 */
async function classifyProbeJevClaude(probe, opts) {
  const env = (opts && opts.env) || process.env;
  const pack = opts && opts.config ? opts.config : loadEvalConfig({ env });
  const jevCfg = cm.resolveJevConfig(env);
  if (!jevCfg.available) {
    return {
      skipped: true,
      reason:
        "AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN) missing for Jev via AI Gateway",
    };
  }

  const state = formatHistoryState(probe);
  const question = jevDepthQuestion(pack, String(probe.conceptId));
  let jev;
  try {
    jev = await cm.scoreDepth(
      {
        conceptTitle: String(probe.conceptId),
        state,
        question,
        model: jevCfg.model,
      },
      { fetchFn: opts && opts.fetchFn, env },
    );
  } catch (err) {
    return {
      skipped: true,
      reason: `Jev score failed: ${err && err.message ? err.message : err}`,
    };
  }

  const localBand = cm.classifyZpdBand(jev.depth, MATERIAL_DEPTH).band;

  const tpl = pack.claudeZpdBand;
  const user = [
    renderTemplate(tpl.userTemplate, {
      conceptId: probe.conceptId,
      history: formatHistory(probe) || "(empty)",
    }),
    "",
    `Jev depth score (0–${jev.maxLevel}): ${jev.score}`,
    `Jev depth [0,1]: ${jev.depth.toFixed(3)}`,
    `Jev confidence: ${jev.confidence}`,
    `Jev probabilities: ${JSON.stringify(jev.probabilities || {})}`,
    `Local ZPD hint from Jev depth vs material ${MATERIAL_DEPTH}: ${localBand}`,
  ].join("\n");

  const claude = await callClaudeMessages({
    system: tpl.system,
    user,
    maxTokens: 20,
    temperature: 0,
    env,
    fetchFn: opts && opts.fetchFn,
  });

  if (claude.skipped) {
    // Still a valid Jev-only structured baseline when Claude key is absent.
    return {
      skipped: false,
      band: localBand,
      method: "jev+local-zpd",
      jevDepth: jev.depth,
      jevScore: jev.score,
      jevConfidence: jev.confidence,
      probabilities: jev.probabilities,
      model: jevCfg.model,
      version: pack.version,
      claudeSkipped: claude.reason,
    };
  }

  return {
    skipped: false,
    band: parseBand(claude.text),
    method: "jev+claude",
    jevDepth: jev.depth,
    jevScore: jev.score,
    jevConfidence: jev.confidence,
    probabilities: jev.probabilities,
    claudeRaw: claude.text,
    claudeProvider: claude.provider,
    model: `${jevCfg.model}+${claude.model}`,
    version: pack.version,
  };
}

/**
 * @param {object[]} probes
 * @param {{ fetchFn?: typeof fetch, env?: NodeJS.ProcessEnv, limit?: number, config?: object }} [opts]
 */
async function runJevClaudeBaseline(probes, opts) {
  const env = (opts && opts.env) || process.env;
  if (!cm.resolveJevConfig(env).available) {
    return {
      skipped: true,
      reason:
        "AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN) missing for Jev via AI Gateway",
      yTrue: [],
      yPred: [],
      labels: [],
      scores: [],
    };
  }
  const pack = opts && opts.config ? opts.config : loadEvalConfig({ env });
  const limit = (opts && opts.limit) || probes.length;
  const slice = probes.slice(0, limit);
  const yTrue = [];
  const yPred = [];
  const labels = [];
  const scores = [];
  const rows = [];

  for (const probe of slice) {
    const result = await classifyProbeJevClaude(probe, { ...opts, config: pack });
    if (result.skipped) {
      return {
        skipped: true,
        reason: result.reason,
        yTrue: [],
        yPred: [],
        labels: [],
        scores: [],
      };
    }
    yTrue.push(probe.band);
    yPred.push(result.band);
    rows.push(result);
    if (typeof probe.nextCorrect === "boolean") {
      labels.push(probe.nextCorrect ? 1 : 0);
      scores.push(
        typeof result.jevDepth === "number"
          ? result.jevDepth
          : result.band === "too_easy"
            ? 0.85
            : result.band === "in_zpd"
              ? 0.55
              : 0.25,
      );
    }
  }

  const methods = new Set(rows.map((r) => r.method));
  return {
    skipped: false,
    yTrue,
    yPred,
    labels,
    scores,
    method: methods.size === 1 ? [...methods][0] : "jev+claude-mixed",
    version: pack.version,
    n: slice.length,
    rows,
  };
}

module.exports = {
  classifyProbeJevClaude,
  runJevClaudeBaseline,
  formatHistoryState,
  MATERIAL_DEPTH,
};
