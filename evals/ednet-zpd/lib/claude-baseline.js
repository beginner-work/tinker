"use strict";

/**
 * Plain-Claude ZPD band baseline (no agent modeling).
 * Instructions loaded from versioned eval config.
 * Routes via Vercel AI Gateway when gateway auth is present;
 * otherwise Anthropic direct with ANTHROPIC_API_KEY.
 */

const {
  loadEvalConfig,
  renderTemplate,
} = require("../../config/load.js");
const {
  callClaudeMessages,
  resolveClaudeTransport,
} = require("../../lib/claude-client.js");

function claudeAvailable(env) {
  return resolveClaudeTransport(env || process.env).available;
}

function formatHistory(probe) {
  const rows = (probe.fullHistory || probe.history || []).slice(-40);
  return rows
    .map(
      (h, i) =>
        `${i + 1}. concept=${h.conceptId} correct=${h.correct ? "yes" : "no"}`,
    )
    .join("\n");
}

/**
 * @param {object} probe
 * @param {{ fetchFn?: typeof fetch, env?: NodeJS.ProcessEnv, model?: string, config?: object }} [opts]
 */
async function classifyProbeWithClaude(probe, opts) {
  const env = (opts && opts.env) || process.env;
  if (!claudeAvailable(env)) {
    return {
      skipped: true,
      reason:
        "Claude unavailable: set AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN) or ANTHROPIC_API_KEY",
    };
  }
  const pack = opts && opts.config ? opts.config : loadEvalConfig({ env });
  const tpl = pack.claudeZpdBand;
  const user = renderTemplate(tpl.userTemplate, {
    conceptId: probe.conceptId,
    history: formatHistory(probe) || "(empty)",
  });

  const result = await callClaudeMessages({
    system: tpl.system,
    user,
    maxTokens: 20,
    temperature: 0,
    model: opts && opts.model,
    env,
    fetchFn: opts && opts.fetchFn,
  });
  if (result.skipped) {
    return result;
  }
  return {
    skipped: false,
    band: parseBand(result.text),
    raw: result.text,
    model: result.model,
    provider: result.provider,
    version: pack.version,
  };
}

function parseBand(text) {
  const t = String(text || "").toLowerCase();
  if (t.includes("too_easy")) return "too_easy";
  if (t.includes("too_hard")) return "too_hard";
  if (t.includes("in_zpd") || t.includes("zpd")) return "in_zpd";
  return "in_zpd";
}

/**
 * @param {object[]} probes
 * @param {{ fetchFn?: typeof fetch, env?: NodeJS.ProcessEnv, limit?: number, config?: object }} [opts]
 */
async function runClaudeBaseline(probes, opts) {
  if (!claudeAvailable(opts && opts.env)) {
    return {
      skipped: true,
      reason:
        "Claude unavailable: set AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN) or ANTHROPIC_API_KEY",
      yTrue: [],
      yPred: [],
      labels: [],
      scores: [],
    };
  }
  const pack = opts && opts.config ? opts.config : loadEvalConfig({ env: opts && opts.env });
  const limit = (opts && opts.limit) || probes.length;
  const slice = probes.slice(0, limit);
  const yTrue = [];
  const yPred = [];
  const labels = [];
  const scores = [];

  for (const probe of slice) {
    const result = await classifyProbeWithClaude(probe, { ...opts, config: pack });
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
    if (typeof probe.nextCorrect === "boolean") {
      labels.push(probe.nextCorrect ? 1 : 0);
      scores.push(
        result.band === "too_easy" ? 0.85 : result.band === "in_zpd" ? 0.55 : 0.25,
      );
    }
  }
  return {
    skipped: false,
    yTrue,
    yPred,
    labels,
    scores,
    method: "claude-band",
    version: pack.version,
    n: slice.length,
  };
}

module.exports = {
  claudeAvailable,
  /** @deprecated use claudeAvailable */
  anthropicKey: (env) =>
    claudeAvailable(env) ? "present" : "",
  classifyProbeWithClaude,
  runClaudeBaseline,
  parseBand,
  formatHistory,
};
