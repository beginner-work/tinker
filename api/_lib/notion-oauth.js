/* Notion public-integration OAuth helpers.
 *
 * Env (required for Connect Notion):
 *   NOTION_OAUTH_CLIENT_ID
 *   NOTION_OAUTH_CLIENT_SECRET
 *   NOTION_OAUTH_REDIRECT_URI
 *
 * Authorize: https://api.notion.com/v1/oauth/authorize
 * Token:     https://api.notion.com/v1/oauth/token (Basic client_id:client_secret)
 */

"use strict";

const crypto = require("crypto");

const AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize";
const TOKEN_URL = "https://api.notion.com/v1/oauth/token";
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

function fail(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function trimEnv(name) {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : "";
}

function getConfig() {
  const clientId = trimEnv("NOTION_OAUTH_CLIENT_ID");
  const clientSecret = trimEnv("NOTION_OAUTH_CLIENT_SECRET");
  const redirectUri = trimEnv("NOTION_OAUTH_REDIRECT_URI");
  return { clientId, clientSecret, redirectUri };
}

function isConfigured() {
  const { clientId, clientSecret, redirectUri } = getConfig();
  return !!(clientId && clientSecret && redirectUri);
}

function requireConfig() {
  const config = getConfig();
  if (!config.clientId || !config.clientSecret || !config.redirectUri) {
    throw fail(
      503,
      "Notion OAuth is not configured. Set NOTION_OAUTH_CLIENT_ID, NOTION_OAUTH_CLIENT_SECRET, and NOTION_OAUTH_REDIRECT_URI.",
      "notion_oauth_unconfigured",
    );
  }
  if (!/^https:\/\//i.test(config.redirectUri)) {
    throw fail(500, "NOTION_OAUTH_REDIRECT_URI must be an https URL.", "notion_oauth_bad_redirect");
  }
  return config;
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function generateState() {
  return b64url(crypto.randomBytes(24));
}

function hashState(state) {
  return crypto.createHash("sha256").update(String(state), "utf8").digest("hex");
}

function stateExpiresAt(now = Date.now()) {
  return new Date(now + OAUTH_STATE_TTL_MS).toISOString();
}

function buildAuthorizeUrl({ clientId, redirectUri, state }) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("owner", "user");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

function basicAuthHeader(clientId, clientSecret) {
  const raw = `${clientId}:${clientSecret}`;
  return "Basic " + Buffer.from(raw, "utf8").toString("base64");
}

async function exchangeCode({ code, redirectUri, clientId, clientSecret, fetchImpl }) {
  const fetchFn = fetchImpl || fetch;
  if (typeof code !== "string" || !code.trim()) {
    throw fail(400, "Missing OAuth code.", "notion_oauth_missing_code");
  }
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code: code.trim(),
      redirect_uri: redirectUri,
    }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (payload && (payload.error_description || payload.message || payload.error)) ||
      `Notion token exchange failed (${res.status}).`;
    throw fail(res.status >= 400 && res.status < 500 ? 400 : 502, String(msg), "notion_oauth_token_failed");
  }
  if (!payload || !payload.access_token) {
    throw fail(502, "Notion token response missing access_token.", "notion_oauth_token_missing");
  }
  return {
    accessToken: String(payload.access_token),
    tokenType: payload.token_type ? String(payload.token_type) : "bearer",
    botId: payload.bot_id ? String(payload.bot_id) : "",
    workspaceId: payload.workspace_id ? String(payload.workspace_id) : "",
    workspaceName: payload.workspace_name ? String(payload.workspace_name) : "",
    workspaceIcon: payload.workspace_icon ? String(payload.workspace_icon) : "",
    owner: payload.owner || null,
    duplicatedTemplateId: payload.duplicated_template_id
      ? String(payload.duplicated_template_id)
      : "",
  };
}

module.exports = {
  AUTHORIZE_URL,
  TOKEN_URL,
  OAUTH_STATE_TTL_MS,
  getConfig,
  isConfigured,
  requireConfig,
  generateState,
  hashState,
  stateExpiresAt,
  buildAuthorizeUrl,
  exchangeCode,
  basicAuthHeader,
};
