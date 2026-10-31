"use strict";

/**
 * Vercel AI Gateway auth for Jev (TypeSafe System One) and optional Claude.
 *
 * Prefers AI_GATEWAY_API_KEY; falls back to VERCEL_OIDC_TOKEN (auto on Vercel
 * deploys; local via `vercel env pull`). Never logs credential values.
 */

const AI_GATEWAY_BASE = "https://ai-gateway.vercel.sh";
const AI_GATEWAY_TYPESAFE_BASE = `${AI_GATEWAY_BASE}/typesafe`;
const AI_GATEWAY_SYSTEMONE = `${AI_GATEWAY_TYPESAFE_BASE}/v1/systemone`;
const AI_GATEWAY_MESSAGES = `${AI_GATEWAY_BASE}/v1/messages`;

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ available: boolean, token: string, source: 'api_key' | 'oidc' | null }}
 */
function resolveGatewayAuth(env) {
  const e = env || process.env;
  const apiKey = String(e.AI_GATEWAY_API_KEY || "").trim();
  if (apiKey) {
    return { available: true, token: apiKey, source: "api_key" };
  }
  const oidc = String(e.VERCEL_OIDC_TOKEN || "").trim();
  if (oidc) {
    return { available: true, token: oidc, source: "oidc" };
  }
  return { available: false, token: "", source: null };
}

module.exports = {
  AI_GATEWAY_BASE,
  AI_GATEWAY_TYPESAFE_BASE,
  AI_GATEWAY_SYSTEMONE,
  AI_GATEWAY_MESSAGES,
  resolveGatewayAuth,
};
