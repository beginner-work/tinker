/* Outbound MCP OAuth 2.1 helpers: discovery, DCR, PKCE, token exchange/refresh.
 *
 * Used by Connections (Tinker as MCP client). Not the inbound mcp-oauth.js
 * authorization server that mints mcp_ bearers for bots.
 */

"use strict";

const crypto = require("crypto");

const PKCE_METHOD = "S256";
const CLIENT_NAME = "Tinker";
const CLIENT_URI = "https://tinker.beginner.work";

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function generatePkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge, method: PKCE_METHOD };
}

function generateState() {
  return b64url(crypto.randomBytes(24));
}

function hashState(state) {
  return crypto.createHash("sha256").update(String(state), "utf8").digest("hex");
}

/**
 * RFC 9470 protected-resource metadata, then RFC 8414 AS metadata.
 * Tries path-aware PRM first (…/mcp → /.well-known/.../mcp), then root.
 */
async function discoverOAuthMetadata(mcpServerUrl, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  const url = new URL(mcpServerUrl);
  const candidates = [
    new URL("/.well-known/oauth-protected-resource" + url.pathname.replace(/\/$/, ""), url.origin).toString(),
    new URL("/.well-known/oauth-protected-resource", url.origin).toString(),
  ];
  let protectedResource = null;
  let lastStatus = 0;
  for (const prmUrl of candidates) {
    const res = await fetchFn(prmUrl, { headers: { Accept: "application/json" } });
    lastStatus = res.status;
    if (res.ok) {
      protectedResource = await res.json().catch(() => null);
      if (protectedResource) break;
    }
  }
  if (!protectedResource) {
    throw fail(502, `Could not load OAuth protected-resource metadata (${lastStatus}).`);
  }
  const authServers = protectedResource.authorization_servers;
  if (!Array.isArray(authServers) || !authServers.length) {
    throw fail(502, "No authorization servers in protected-resource metadata.");
  }
  const authServerUrl = String(authServers[0]).replace(/\/$/, "");
  const metadataUrl = `${authServerUrl}/.well-known/oauth-authorization-server`;
  const metaRes = await fetchFn(metadataUrl, { headers: { Accept: "application/json" } });
  if (!metaRes.ok) {
    throw fail(502, `Could not load authorization-server metadata (${metaRes.status}).`);
  }
  const metadata = await metaRes.json().catch(() => null);
  if (!metadata || !metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw fail(502, "Authorization-server metadata is missing endpoints.");
  }
  return {
    resource: String(protectedResource.resource || mcpServerUrl),
    authorizationServers: authServers.map(String),
    metadata,
  };
}

async function registerPublicClient({ metadata, redirectUri, fetchImpl }) {
  const fetchFn = fetchImpl || fetch;
  const endpoint = metadata && metadata.registration_endpoint;
  if (!endpoint) {
    throw fail(502, "Server does not support dynamic client registration.");
  }
  const body = {
    client_name: CLIENT_NAME,
    client_uri: CLIENT_URI,
    redirect_uris: [redirectUri],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    token_endpoint_auth_methods: ["none"],
  };
  const res = await fetchFn(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (payload && (payload.error_description || payload.error)) ||
      `Dynamic client registration failed (${res.status}).`;
    throw fail(res.status >= 400 && res.status < 500 ? 400 : 502, String(msg));
  }
  if (!payload || !payload.client_id) {
    throw fail(502, "Registration response missing client_id.");
  }
  return {
    clientId: String(payload.client_id),
    clientSecret: payload.client_secret ? String(payload.client_secret) : "",
  };
}

function buildAuthorizeUrl({
  metadata,
  clientId,
  redirectUri,
  state,
  codeChallenge,
  resource,
  scope,
}) {
  const authUrl = new URL(metadata.authorization_endpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", PKCE_METHOD);
  if (resource) authUrl.searchParams.set("resource", resource);
  if (scope) authUrl.searchParams.set("scope", scope);
  else if (Array.isArray(metadata.scopes_supported) && metadata.scopes_supported.length) {
    authUrl.searchParams.set("scope", metadata.scopes_supported[0]);
  }
  return authUrl.toString();
}

async function exchangeToken({
  metadata,
  clientId,
  redirectUri,
  code,
  codeVerifier,
  resource,
  fetchImpl,
}) {
  const fetchFn = fetchImpl || fetch;
  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("client_id", clientId);
  form.set("redirect_uri", redirectUri);
  form.set("code", code);
  form.set("code_verifier", codeVerifier);
  if (resource) form.set("resource", resource);
  const res = await fetchFn(metadata.token_endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (payload && (payload.error_description || payload.error)) ||
      `Token exchange failed (${res.status}).`;
    throw fail(res.status >= 400 && res.status < 500 ? 400 : 502, String(msg));
  }
  return shapeTokens(payload);
}

async function refreshAccessToken({
  metadata,
  clientId,
  refreshToken,
  resource,
  fetchImpl,
}) {
  const fetchFn = fetchImpl || fetch;
  const form = new URLSearchParams();
  form.set("grant_type", "refresh_token");
  form.set("client_id", clientId);
  form.set("refresh_token", refreshToken);
  if (resource) form.set("resource", resource);
  const res = await fetchFn(metadata.token_endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (payload && (payload.error_description || payload.error)) ||
      `Token refresh failed (${res.status}).`;
    const status = payload && payload.error === "invalid_grant" ? 401 : 502;
    throw fail(status, String(msg));
  }
  return shapeTokens(payload);
}

function shapeTokens(payload) {
  if (!payload || !payload.access_token) {
    throw fail(502, "Token response missing access_token.");
  }
  const expiresIn = Number(payload.expires_in) || 3600;
  return {
    accessToken: String(payload.access_token),
    refreshToken: payload.refresh_token ? String(payload.refresh_token) : "",
    tokenType: payload.token_type ? String(payload.token_type) : "Bearer",
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scope: payload.scope ? String(payload.scope) : "",
  };
}

module.exports = {
  generatePkce,
  generateState,
  hashState,
  discoverOAuthMetadata,
  registerPublicClient,
  buildAuthorizeUrl,
  exchangeToken,
  refreshAccessToken,
  CLIENT_NAME,
  CLIENT_URI,
};
