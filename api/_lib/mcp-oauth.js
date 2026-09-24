/* MCP OAuth 2.1 authorization-code store.
 *
 * Public clients register a redirect URI, send the user to tinker to
 * approve, then exchange the code with PKCE S256. The access token is
 * an mcp_ bearer. Only its hash is stored. It stays valid until revoke.
 * There is no refresh token and no client secret.
 *
 * Tables are created on first use. Vercel builds do not run migrate
 * deploy, same as McpApiKey.
 */

"use strict";

const crypto = require("crypto");
const {
  ensureTable,
  hashKey,
  mintMcpKey,
} = require("./mcp-keys.js");

const CLIENT_ID = /^tkncl_[a-f0-9]{32}$/;
const CODE_TTL_MS = 10 * 60 * 1000;

const OAUTH_TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "McpOAuthClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "redirectUris" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpOAuthClient_pkey" PRIMARY KEY ("id")
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "McpOAuthClient_clientId_key" ON "McpOAuthClient"("clientId")`,
  `CREATE TABLE IF NOT EXISTS "McpOAuthCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpOAuthCode_pkey" PRIMARY KEY ("id")
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "McpOAuthCode_codeHash_key" ON "McpOAuthCode"("codeHash")`,
];

let ensuring = null;

function db() {
  return require("./db.js");
}

function oauthError(status, error, description) {
  return Object.assign(new Error(description || error), {
    status,
    oauthError: error,
  });
}

function storeDown(err) {
  if (err && (err.status || err.oauthError)) return err;
  return Object.assign(new Error("MCP authorization store unavailable."), {
    status: 503,
    cause: err,
  });
}

function resetOauthCache() {
  ensuring = null;
}

async function ensureOauthTables() {
  if (ensuring) return ensuring;
  ensuring = (async () => {
    await ensureTable();
    const prisma = db();
    for (const statement of OAUTH_TABLE_STATEMENTS) {
      await prisma.$executeRawUnsafe(statement);
    }
  })().catch((err) => {
    ensuring = null;
    throw Object.assign(new Error("Could not prepare MCP authorization tables."), {
      status: 503,
      cause: err,
    });
  });
  return ensuring;
}

function validRedirectUri(uri) {
  if (typeof uri !== "string" || uri.length < 8 || uri.length > 512) return false;
  if (uri.includes("\\") || uri.includes("\n") || uri.includes("\r")) return false;
  let url;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol !== "http:") return false;
  const host = url.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function normalizeClientName(name) {
  if (name == null || name === "") return "MCP client";
  if (typeof name !== "string") {
    throw oauthError(400, "invalid_client_metadata", "client_name must be a string.");
  }
  const trimmed = name.trim();
  if (!trimmed) return "MCP client";
  if (trimmed.length > 80 || /[\r\n]/.test(trimmed)) {
    throw oauthError(400, "invalid_client_metadata", "client_name must be 80 characters or fewer.");
  }
  return trimmed;
}

function normalizeRedirects(uris) {
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5) {
    throw oauthError(
      400,
      "invalid_redirect_uri",
      "redirect_uris must list one to five https or loopback URLs.",
    );
  }
  const clean = [];
  for (const uri of uris) {
    if (!validRedirectUri(uri)) {
      throw oauthError(400, "invalid_redirect_uri", "A redirect URI is not allowed.");
    }
    if (!clean.includes(uri)) clean.push(uri);
  }
  return clean;
}

function metadataGrants(body) {
  const grants = body.grant_types;
  if (grants == null) return;
  if (!Array.isArray(grants) || grants.length !== 1 || grants[0] !== "authorization_code") {
    throw oauthError(
      400,
      "invalid_client_metadata",
      "grant_types must be authorization_code. This server does not issue refresh tokens.",
    );
  }
  const responses = body.response_types;
  if (responses == null) return;
  if (!Array.isArray(responses) || responses.length !== 1 || responses[0] !== "code") {
    throw oauthError(400, "invalid_client_metadata", "response_types must be code.");
  }
  const method = body.token_endpoint_auth_method;
  if (method != null && method !== "none") {
    throw oauthError(
      400,
      "invalid_client_metadata",
      "token_endpoint_auth_method must be none. Use PKCE.",
    );
  }
}

async function registerClient(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw oauthError(400, "invalid_client_metadata", "Registration body must be a JSON object.");
  }
  metadataGrants(body);
  const clientName = normalizeClientName(body.client_name);
  const redirectUris = normalizeRedirects(body.redirect_uris);
  const clientId = `tkncl_${crypto.randomBytes(16).toString("hex")}`;
  await ensureOauthTables();
  try {
    await db().mcpOAuthClient.create({
      data: {
        clientId,
        clientName,
        redirectUris: JSON.stringify(redirectUris),
      },
    });
  } catch (err) {
    throw storeDown(err);
  }
  return {
    client_id: clientId,
    client_name: clientName,
    redirect_uris: redirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

function readRedirects(row) {
  try {
    const parsed = JSON.parse(row.redirectUris);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function loadClient(clientId) {
  if (!CLIENT_ID.test(clientId || "")) return null;
  await ensureOauthTables();
  try {
    return await db().mcpOAuthClient.findUnique({ where: { clientId } });
  } catch (err) {
    throw storeDown(err);
  }
}

function resourceFor(origin) {
  return `${origin}/api/mcp`;
}

function parseAuthorizeParams(input, origin) {
  const source = input || {};
  if (source.response_type !== "code") {
    throw oauthError(400, "unsupported_response_type", "response_type must be code.");
  }
  const clientId = typeof source.client_id === "string" ? source.client_id : "";
  if (!CLIENT_ID.test(clientId)) {
    throw oauthError(400, "invalid_request", "client_id is not valid.");
  }
  const redirectUri = typeof source.redirect_uri === "string" ? source.redirect_uri : "";
  if (!validRedirectUri(redirectUri)) {
    throw oauthError(400, "invalid_request", "redirect_uri is not allowed.");
  }
  if (source.code_challenge_method !== "S256") {
    throw oauthError(400, "invalid_request", "code_challenge_method must be S256.");
  }
  const codeChallenge = typeof source.code_challenge === "string" ? source.code_challenge : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    throw oauthError(400, "invalid_request", "code_challenge must be S256.");
  }
  const expected = resourceFor(origin);
  if (source.resource !== expected) {
    throw oauthError(400, "invalid_target", `resource must be ${expected}`);
  }
  let state = "";
  if (source.state != null && source.state !== "") {
    state = String(source.state);
    if (state.length > 512 || /[\r\n]/.test(state)) {
      throw oauthError(400, "invalid_request", "state is not valid.");
    }
  }
  return {
    clientId,
    redirectUri,
    codeChallenge,
    resource: expected,
    state,
  };
}

function redirectWith(redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

async function clientForAuthorize(params) {
  const row = await loadClient(params.clientId);
  if (!row) {
    throw oauthError(400, "invalid_request", "This connector is not registered.");
  }
  const redirects = readRedirects(row);
  if (!redirects.includes(params.redirectUri)) {
    throw oauthError(400, "invalid_request", "Redirect URI is not registered.");
  }
  return row;
}

async function issueCode({ row, params, userId }) {
  const code = crypto.randomBytes(32).toString("base64url");
  await ensureOauthTables();
  try {
    await db().mcpOAuthCode.create({
      data: {
        codeHash: hashKey(code),
        clientId: row.clientId,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        resource: params.resource,
        userId,
        label: row.clientName,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
  } catch (err) {
    throw storeDown(err);
  }
  return code;
}

async function decideAuthorization({ userId, decision, params }) {
  const row = await clientForAuthorize(params);
  if (decision === "deny") {
    return {
      redirect: redirectWith(params.redirectUri, {
        error: "access_denied",
        state: params.state,
      }),
      clientName: row.clientName,
    };
  }
  if (decision !== "approve") {
    throw oauthError(400, "invalid_request", "decision must be approve or deny.");
  }
  const code = await issueCode({ row, params, userId });
  return {
    redirect: redirectWith(params.redirectUri, {
      code,
      state: params.state,
    }),
    clientName: row.clientName,
  };
}

function invalidGrant() {
  return oauthError(400, "invalid_grant", "Authorization code is not valid.");
}

function pkceMatches(verifier, challenge) {
  if (typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  if (typeof challenge !== "string" || challenge.length !== 43) return false;
  const actual = crypto.createHash("sha256").update(verifier).digest("base64url");
  if (actual.length !== challenge.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(challenge));
}

async function exchangeCode({ origin, body }) {
  const source = body || {};
  const grant = source.grant_type;
  if (!grant) throw oauthError(400, "invalid_request", "grant_type is required.");
  if (grant !== "authorization_code") {
    throw oauthError(400, "unsupported_grant_type", "grant_type must be authorization_code.");
  }
  const clientId = typeof source.client_id === "string" ? source.client_id : "";
  const row = await loadClient(clientId);
  if (!row) throw oauthError(400, "invalid_client", "client_id is not registered.");
  const redirectUri = typeof source.redirect_uri === "string" ? source.redirect_uri : "";
  if (!readRedirects(row).includes(redirectUri)) {
    throw oauthError(400, "invalid_grant", "redirect_uri does not match.");
  }
  const expected = resourceFor(origin);
  if (source.resource !== expected) {
    throw oauthError(400, "invalid_target", `resource must be ${expected}`);
  }
  const code = typeof source.code === "string" ? source.code : "";
  if (!code || code.length > 200) throw invalidGrant();
  await ensureOauthTables();
  let stored;
  try {
    stored = await db().mcpOAuthCode.findUnique({ where: { codeHash: hashKey(code) } });
  } catch (err) {
    throw storeDown(err);
  }
  const expired = !stored || stored.expiresAt <= new Date() || stored.usedAt;
  const mismatch = !stored
    || stored.clientId !== clientId
    || stored.redirectUri !== redirectUri
    || stored.resource !== expected
    || !pkceMatches(source.code_verifier, stored && stored.codeChallenge);
  if (expired || mismatch) throw invalidGrant();
  try {
    await db().mcpOAuthCode.update({
      where: { id: stored.id },
      data: { usedAt: new Date() },
    });
  } catch (err) {
    throw storeDown(err);
  }
  if (!stored.userId) throw invalidGrant();
  const minted = await mintMcpKey({ label: stored.label, userId: stored.userId });
  return {
    access_token: minted.key,
    token_type: "Bearer",
    scope: "mcp",
  };
}

module.exports = {
  OAUTH_TABLE_STATEMENTS,
  CLIENT_ID,
  resetOauthCache,
  ensureOauthTables,
  validRedirectUri,
  registerClient,
  loadClient,
  parseAuthorizeParams,
  clientForAuthorize,
  decideAuthorization,
  exchangeCode,
  resourceFor,
};
