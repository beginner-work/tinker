"use strict";

/**
 * Plain-Claude ZPD band baseline (no agent modeling).
 * Instructions loaded from versioned eval config.
 */

const {
  loadEvalConfig,
  renderTemplate,
} = require("../../config/load.js");

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

function anthropicKey(env) {
  return String((env || process.env).ANTHROPIC_API_KEY || "").trim();
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
  const key = anthropicKey(env);
  if (!key) {
    return { skipped: true, reason: "ANTHROPIC_API_KEY missing" };
  }
  const pack = opts && opts.config ? opts.config : loadEvalConfig({ env });
  const tpl = pack.claudeZpdBand;
  const fetchFn = (opts && opts.fetchFn) || globalThis.fetch;
  const model = (opts && opts.model) || env.ASK_MODEL || DEFAULT_MODEL;
  const user = renderTemplate(tpl.userTemplate, {
    conceptId: probe.conceptId,
    history: formatHistory(probe) || "(empty)",
  });

  const res = await fetchFn("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 20,
      temperature: 0,
      system: tpl.system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      (json && json.error && json.error.message) || `Anthropic HTTP ${res.status}`,
    );
  }
  const text = Array.isArray(json.content)
    ? json.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("")
    : "";
  return { skipped: false, band: parseBand(text), raw: text, model, version: pack.version };
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
  if (!anthropicKey(opts && opts.env)) {
    return {
      skipped: true,
      reason: "ANTHROPIC_API_KEY missing",
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
  anthropicKey,
  classifyProbeWithClaude,
  runClaudeBaseline,
  parseBand,
  formatHistory,
};
