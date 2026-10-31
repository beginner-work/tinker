"use strict";

/**
 * Claude Messages helper for evals.
 * Prefers Vercel AI Gateway (`anthropic/claude-*`) when AI_GATEWAY_API_KEY or
 * VERCEL_OIDC_TOKEN is set. GitHub Actions uses gateway only.
 * Locally, ANTHROPIC_API_KEY remains an optional direct fallback if gateway
 * auth is absent (or as a last resort after a gateway access denial).
 *
 * Gateway free-tier / model ACL failures soft-skip so keyed CI does not
 * hard-fail or fabricate scores.
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
 * Gateway free-tier / billing / model ACL errors should soft-skip (not hard-fail)
 * so keyed CI can stay green and report the skip instead of fabricating scores.
 * @param {number} status
 * @param {string} message
 */
function isClaudeAccessDenied(status, message) {
  const msg = String(message || "");
  return (
    status === 402 ||
    status === 403 ||
    /free tier|do not have access|upgrade to paid|insufficient.?credits?|quota exceeded|billing/i.test(
      msg,
    )
  );
}

/**
 * Direct Anthropic transport when a key is present (used as gateway fallback).
 * @param {NodeJS.ProcessEnv} env
 */
function resolveAnthropicDirect(env) {
  const anthropicKey = String(env.ANTHROPIC_API_KEY || "").trim();
  if (!anthropicKey) return null;
  const rawModel = String(env.ASK_MODEL || DEFAULT_DIRECT_MODEL).trim();
  const model = rawModel.includes("/")
    ? rawModel.replace(/^anthropic\//, "")
    : rawModel;
  return {
    available: true,
    provider: "anthropic",
    url: ANTHROPIC_MESSAGES,
    authHeader: { "x-api-key": anthropicKey },
    model,
    authSource: "anthropic_api_key",
  };
}

/**
 * @param {{
 *   url: string,
 *   authHeader: Record<string, string>,
 *   model: string,
 *   provider: string,
 * }} transport
 * @param {{
 *   system: string,
 *   user: string,
 *   maxTokens?: number,
 *   temperature?: number,
 *   model?: string,
 *   fetchFn?: typeof fetch,
 * }} args
 */
async function postClaudeMessages(transport, args) {
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
  const message =
    (json && json.error && json.error.message) ||
    `Claude HTTP ${res.status} (${transport.provider})`;
  return { res, json, model, message };
}

function textFromClaudeJson(json) {
  return Array.isArray(json && json.content)
    ? json.content
        .filter((b) => b && b.type === "text")
        .map((b) => b.text)
        .join("")
    : "";
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

  let attempt = await postClaudeMessages(transport, args);
  let provider = transport.provider;
  let fallbackFrom = null;

  // Gateway free-tier often cannot call Anthropic models: fall back to direct
  // Anthropic when ANTHROPIC_API_KEY is set, else soft-skip.
  if (
    !attempt.res.ok &&
    transport.provider === "ai-gateway" &&
    isClaudeAccessDenied(attempt.res.status, attempt.message)
  ) {
    const direct = resolveAnthropicDirect(env);
    if (direct) {
      const fallbackModel =
        args.model && String(args.model).includes("/")
          ? String(args.model).replace(/^anthropic\//, "")
          : args.model;
      attempt = await postClaudeMessages(direct, {
        ...args,
        model: fallbackModel,
      });
      provider = direct.provider;
      fallbackFrom = "ai-gateway";
    } else {
      return {
        skipped: true,
        reason: attempt.message,
        status: attempt.res.status,
        provider: transport.provider,
      };
    }
  }

  if (!attempt.res.ok) {
    if (isClaudeAccessDenied(attempt.res.status, attempt.message)) {
      return {
        skipped: true,
        reason: attempt.message,
        status: attempt.res.status,
        provider,
      };
    }
    throw new Error(attempt.message);
  }

  return {
    skipped: false,
    text: textFromClaudeJson(attempt.json),
    model: attempt.model,
    provider,
    raw: attempt.json,
    ...(fallbackFrom ? { fallbackFrom } : {}),
  };
}

module.exports = {
  ANTHROPIC_MESSAGES,
  DEFAULT_DIRECT_MODEL,
  DEFAULT_GATEWAY_MODEL,
  resolveClaudeTransport,
  resolveAnthropicDirect,
  isClaudeAccessDenied,
  callClaudeMessages,
};
