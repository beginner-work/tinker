"use strict";

/**
 * Claude Messages helper for evals.
 * Prefers Vercel AI Gateway when AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN is set;
 * otherwise uses Anthropic directly with ANTHROPIC_API_KEY.
 */

const path = require("node:path");
const {
  AI_GATEWAY_MESSAGES,
  resolveGatewayAuth,
} = require(path.join(
  __dirname,
  "..",
  "..",
  "packages",
  "context-model",
  "src",
  "gateway.js",
));

const ANTHROPIC_MESSAGES = "https://api.anthropic.com/v1/messages";
const DEFAULT_DIRECT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_GATEWAY_MODEL = "anthropic/claude-haiku-4-5-20251001";

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
function resolveClaudeTransport(env) {
  const e = env || process.env;
  const gateway = resolveGatewayAuth(e);
  if (gateway.available) {
    const rawModel = String(e.ASK_MODEL || DEFAULT_GATEWAY_MODEL).trim();
    const model = rawModel.includes("/")
      ? rawModel
      : `anthropic/${rawModel}`;
    return {
      available: true,
      provider: "ai-gateway",
      url: AI_GATEWAY_MESSAGES,
      authHeader: { Authorization: `Bearer ${gateway.token}` },
      model,
      authSource: gateway.source,
    };
  }
  const anthropicKey = String(e.ANTHROPIC_API_KEY || "").trim();
  if (anthropicKey) {
    return {
      available: true,
      provider: "anthropic",
      url: ANTHROPIC_MESSAGES,
      authHeader: { "x-api-key": anthropicKey },
      model: String(e.ASK_MODEL || DEFAULT_DIRECT_MODEL).trim(),
      authSource: "anthropic_api_key",
    };
  }
  return {
    available: false,
    provider: null,
    url: "",
    authHeader: {},
    model: "",
    authSource: null,
  };
}

/**
 * @param {{
 *   system: string,
 *   user: string,
 *   maxTokens?: number,
 *   temperature?: number,
 *   model?: string,
 *   env?: NodeJS.ProcessEnv,
 *   fetchFn?: typeof fetch,
 * }} args
 */
async function callClaudeMessages(args) {
  const env = args.env || process.env;
  const transport = resolveClaudeTransport(env);
  if (!transport.available) {
    return {
      skipped: true,
      reason:
        "Claude unavailable: set AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN) or ANTHROPIC_API_KEY",
    };
  }
  const fetchFn = args.fetchFn || globalThis.fetch;
  const model = args.model || transport.model;
  const res = await fetchFn(transport.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      ...transport.authHeader,
    },
    body: JSON.stringify({
      model,
      max_tokens: args.maxTokens || 20,
      temperature: typeof args.temperature === "number" ? args.temperature : 0,
      system: args.system,
      messages: [{ role: "user", content: args.user }],
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (json && json.error && json.error.message) ||
        `Claude HTTP ${res.status} (${transport.provider})`,
    );
  }
  const text = Array.isArray(json && json.content)
    ? json.content
        .filter((b) => b && b.type === "text")
        .map((b) => b.text)
        .join("")
    : "";
  return {
    skipped: false,
    text,
    model,
    provider: transport.provider,
    raw: json,
  };
}

module.exports = {
  ANTHROPIC_MESSAGES,
  DEFAULT_DIRECT_MODEL,
  DEFAULT_GATEWAY_MODEL,
  resolveClaudeTransport,
  callClaudeMessages,
};
