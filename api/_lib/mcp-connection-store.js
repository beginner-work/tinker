/* Per-user outbound MCP connection tokens (encrypted) in Postgres via Prisma.
 *
 * Kind keys on TinkerUserData:
 *   mcp_out_conn:<connectorId>  — access/refresh tokens for that user
 *   mcp_out_oauth:<stateHash>   — short-lived PKCE state (userId scoped)
 *   mcp_out_dcr:<connectorId>   — cached dynamic client id (userId = SYSTEM)
 *
 * Separate from inbound McpApiKey / mcp_ bearers.
 */

"use strict";

const { encrypt, decrypt } = require("./secrets-crypto.js");
const { getConnector, listConnectors } = require("./mcp-connectors-registry.js");
const oauth = require("./mcp-connection-oauth.js");

const SYSTEM_USER = "__tinker_system__";
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
const WRITE_ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_SKEW_MS = 60 * 1000;

function db() {
  return require("./db.js");
}

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

function requireUserId(userId) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw fail(401, "Sign in to tinker first.");
  }
  return userId.trim();
}

function connKind(connectorId) {
  return "mcp_out_conn:" + String(connectorId);
}

function stateKind(stateHash) {
  return "mcp_out_oauth:" + String(stateHash);
}

function dcrKind(connectorId) {
  return "mcp_out_dcr:" + String(connectorId);
}

function storeDown(err) {
  if (err && err.status) return err;
  return Object.assign(new Error("Connections store unavailable right now."), {
    status: 503,
    cause: err,
  });
}

async function readRaw(userId, kind) {
  const row = await db().tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind } },
  });
  return row && row.data && typeof row.data === "object" ? row.data : null;
}

async function writeRaw(userId, kind, data) {
  await db().tinkerUserData.upsert({
    where: { userId_kind: { userId, kind } },
    create: { userId, kind, data },
    update: { data },
  });
}

async function deleteRaw(userId, kind) {
  try {
    await db().tinkerUserData.delete({
      where: { userId_kind: { userId, kind } },
    });
  } catch (err) {
    if (err && err.code === "P2025") return;
    throw err;
  }
}

function presentPublic(connector, row) {
  const connected = !!(row && row.accessTokenEnc);
  const writeAccess = !!(
    connected &&
    row.writeAccess &&
    row.writeAccessUntil &&
    Date.parse(row.writeAccessUntil) > Date.now()
  );
  return {
    id: connector.id,
    name: connector.name,
    url: connector.url,
    authType: connector.authType,
    description: connector.description,
    defaultReadTools: connector.defaultReadTools.slice(),
    connected,
    connectedAt: connected && row.connectedAt ? String(row.connectedAt) : null,
    writeAccess,
    writeAccessUntil: writeAccess ? String(row.writeAccessUntil) : null,
  };
}

async function listConnections({ userId } = {}) {
  try {
    const uid = requireUserId(userId);
    const connectors = listConnectors();
    const out = [];
    for (const connector of connectors) {
      const row = await readRaw(uid, connKind(connector.id));
      out.push(presentPublic(connector, row));
    }
    return { connectors: out };
  } catch (err) {
    throw storeDown(err);
  }
}

async function getConnectionRow(userId, connectorId) {
  const connector = getConnector(connectorId);
  if (!connector) throw fail(404, "Unknown connector.");
  const row = await readRaw(userId, connKind(connector.id));
  return { connector, row };
}

async function getCachedDcrClient(connectorId) {
  return readRaw(SYSTEM_USER, dcrKind(connectorId));
}

async function saveCachedDcrClient(connectorId, client) {
  await writeRaw(SYSTEM_USER, dcrKind(connectorId), {
    clientId: client.clientId,
    clientSecretEnc: client.clientSecret ? encrypt(client.clientSecret) : "",
    redirectUri: client.redirectUri,
    updatedAt: new Date().toISOString(),
  });
}

async function ensureDcrClient({ connector, redirectUri, fetchImpl }) {
  const cached = await getCachedDcrClient(connector.id);
  if (cached && cached.clientId && cached.redirectUri === redirectUri) {
    return {
      clientId: String(cached.clientId),
      clientSecret: cached.clientSecretEnc ? decrypt(cached.clientSecretEnc) : "",
    };
  }
  const discovered = await oauth.discoverOAuthMetadata(connector.url, fetchImpl);
  const registered = await oauth.registerPublicClient({
    metadata: discovered.metadata,
    redirectUri,
    fetchImpl,
  });
  await saveCachedDcrClient(connector.id, {
    clientId: registered.clientId,
    clientSecret: registered.clientSecret,
    redirectUri,
  });
  return registered;
}

async function beginConnect({ userId, connectorId, redirectUri, fetchImpl } = {}) {
  try {
    const uid = requireUserId(userId);
    const connector = getConnector(connectorId);
    if (!connector) throw fail(404, "Unknown connector.");
    if (connector.authType !== "oauth") {
      throw fail(400, "This connector does not use OAuth.");
    }
    if (typeof redirectUri !== "string" || !redirectUri.startsWith("https://")) {
      throw fail(400, "redirectUri must be https.");
    }

    const discovered = await oauth.discoverOAuthMetadata(connector.url, fetchImpl);
    const client = await ensureDcrClient({
      connector,
      redirectUri,
      fetchImpl,
    });
    const pkce = oauth.generatePkce();
    const state = oauth.generateState();
    const stateHash = oauth.hashState(state);
    const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString();

    await writeRaw(uid, stateKind(stateHash), {
      connectorId: connector.id,
      codeVerifierEnc: encrypt(pkce.verifier),
      clientId: client.clientId,
      redirectUri,
      resource: discovered.resource,
      metadata: {
        authorization_endpoint: discovered.metadata.authorization_endpoint,
        token_endpoint: discovered.metadata.token_endpoint,
        scopes_supported: discovered.metadata.scopes_supported || [],
      },
      expiresAt,
    });

    const authorizeUrl = oauth.buildAuthorizeUrl({
      metadata: discovered.metadata,
      clientId: client.clientId,
      redirectUri,
      state,
      codeChallenge: pkce.challenge,
      resource: discovered.resource,
    });

    return { authorizeUrl, connectorId: connector.id, expiresAt };
  } catch (err) {
    throw storeDown(err);
  }
}

async function completeConnect({ code, state, fetchImpl } = {}) {
  try {
    if (typeof code !== "string" || !code.trim()) {
      throw fail(400, "Missing authorization code.");
    }
    if (typeof state !== "string" || !state.trim()) {
      throw fail(400, "Missing OAuth state.");
    }
    const stateHash = oauth.hashState(state);

    // Find pending state across users by scanning is not possible; store
    // a lookup row keyed by state hash under SYSTEM that points at userId.
    const lookup = await readRaw(SYSTEM_USER, stateKind(stateHash));
    let userId = lookup && lookup.userId ? String(lookup.userId) : "";
    let pending = userId ? await readRaw(userId, stateKind(stateHash)) : null;

    if (!pending) {
      // Fallback: state row may only exist on the user (tests / older path).
      throw fail(400, "OAuth state is unknown or expired. Start Connect again.");
    }
    if (pending.expiresAt && Date.parse(pending.expiresAt) < Date.now()) {
      await deleteRaw(userId, stateKind(stateHash));
      if (lookup) await deleteRaw(SYSTEM_USER, stateKind(stateHash));
      throw fail(400, "OAuth state expired. Start Connect again.");
    }

    const connector = getConnector(pending.connectorId);
    if (!connector) throw fail(404, "Unknown connector.");

    const tokens = await oauth.exchangeToken({
      metadata: pending.metadata,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      code: code.trim(),
      codeVerifier: decrypt(pending.codeVerifierEnc),
      resource: pending.resource,
      fetchImpl,
    });

    const prev = (await readRaw(userId, connKind(connector.id))) || {};
    const data = {
      accessTokenEnc: encrypt(tokens.accessToken),
      refreshTokenEnc: tokens.refreshToken ? encrypt(tokens.refreshToken) : "",
      expiresAt: tokens.expiresAt,
      clientId: pending.clientId,
      resource: pending.resource || connector.url,
      tokenEndpoint: pending.metadata && pending.metadata.token_endpoint,
      connectedAt: prev.connectedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      writeAccess: false,
      writeAccessUntil: null,
    };
    await writeRaw(userId, connKind(connector.id), data);
    await deleteRaw(userId, stateKind(stateHash));
    if (lookup) await deleteRaw(SYSTEM_USER, stateKind(stateHash));

    return { connectorId: connector.id, userId };
  } catch (err) {
    throw storeDown(err);
  }
}

/** Save state lookup so the browser callback (no session) can find the user. */
async function saveStateLookup({ userId, state } = {}) {
  const uid = requireUserId(userId);
  if (typeof state !== "string" || !state) throw fail(400, "state required");
  const stateHash = oauth.hashState(state);
  await writeRaw(SYSTEM_USER, stateKind(stateHash), {
    userId: uid,
    expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString(),
  });
  return stateHash;
}

async function beginConnectWithLookup(args) {
  const result = await beginConnect(args);
  // Re-derive state from authorize URL so we can index it for the callback.
  const url = new URL(result.authorizeUrl);
  const state = url.searchParams.get("state");
  if (state) await saveStateLookup({ userId: args.userId, state });
  return result;
}

async function disconnect({ userId, connectorId } = {}) {
  try {
    const uid = requireUserId(userId);
    const connector = getConnector(connectorId);
    if (!connector) throw fail(404, "Unknown connector.");
    await deleteRaw(uid, connKind(connector.id));
    return { ok: true, connectorId: connector.id };
  } catch (err) {
    throw storeDown(err);
  }
}

async function setWriteAccess({ userId, connectorId, enabled, confirmed } = {}) {
  try {
    const uid = requireUserId(userId);
    const { connector, row } = await getConnectionRow(uid, connectorId);
    if (!row || !row.accessTokenEnc) {
      throw fail(400, "Connect " + connector.name + " before allowing writes.");
    }
    if (enabled) {
      if (!confirmed) {
        throw fail(400, "Confirm write access in the UI before enabling write tools.");
      }
      row.writeAccess = true;
      row.writeAccessUntil = new Date(Date.now() + WRITE_ACCESS_TTL_MS).toISOString();
    } else {
      row.writeAccess = false;
      row.writeAccessUntil = null;
    }
    row.updatedAt = new Date().toISOString();
    await writeRaw(uid, connKind(connector.id), row);
    return presentPublic(connector, row);
  } catch (err) {
    throw storeDown(err);
  }
}

async function getValidAccessToken({ userId, connectorId, fetchImpl } = {}) {
  const uid = requireUserId(userId);
  const { connector, row } = await getConnectionRow(uid, connectorId);
  if (!row || !row.accessTokenEnc) return null;

  const expiresAt = row.expiresAt ? Date.parse(row.expiresAt) : 0;
  const stillFresh = expiresAt && expiresAt - REFRESH_SKEW_MS > Date.now();
  if (stillFresh || !row.refreshTokenEnc) {
    return {
      connector,
      accessToken: decrypt(row.accessTokenEnc),
      writeAccess: !!(
        row.writeAccess &&
        row.writeAccessUntil &&
        Date.parse(row.writeAccessUntil) > Date.now()
      ),
      row,
    };
  }

  if (!row.tokenEndpoint || !row.clientId) {
    return {
      connector,
      accessToken: decrypt(row.accessTokenEnc),
      writeAccess: !!(
        row.writeAccess &&
        row.writeAccessUntil &&
        Date.parse(row.writeAccessUntil) > Date.now()
      ),
      row,
    };
  }

  try {
    const tokens = await oauth.refreshAccessToken({
      metadata: { token_endpoint: row.tokenEndpoint },
      clientId: row.clientId,
      refreshToken: decrypt(row.refreshTokenEnc),
      resource: row.resource || connector.url,
      fetchImpl,
    });
    row.accessTokenEnc = encrypt(tokens.accessToken);
    if (tokens.refreshToken) row.refreshTokenEnc = encrypt(tokens.refreshToken);
    row.expiresAt = tokens.expiresAt;
    row.updatedAt = new Date().toISOString();
    await writeRaw(uid, connKind(connector.id), row);
    return {
      connector,
      accessToken: tokens.accessToken,
      writeAccess: !!(
        row.writeAccess &&
        row.writeAccessUntil &&
        Date.parse(row.writeAccessUntil) > Date.now()
      ),
      row,
    };
  } catch (err) {
    if (err && err.status === 401) {
      await deleteRaw(uid, connKind(connector.id));
      throw fail(401, connector.name + " connection expired. Connect again.");
    }
    throw err;
  }
}

/**
 * Build Anthropic mcp_servers + mcp_toolset entries for every connected
 * connector that still has a valid token.
 */
async function buildAnthropicMcpAttachment({ userId, fetchImpl } = {}) {
  const uid = requireUserId(userId);
  const connectors = listConnectors();
  const mcpServers = [];
  const tools = [];

  for (const connector of connectors) {
    let live;
    try {
      live = await getValidAccessToken({
        userId: uid,
        connectorId: connector.id,
        fetchImpl,
      });
    } catch {
      live = null;
    }
    if (!live) continue;

    const serverName = "tinker-" + connector.id;
    mcpServers.push({
      type: "url",
      url: connector.url,
      name: serverName,
      authorization_token: live.accessToken,
    });

    const toolset = {
      type: "mcp_toolset",
      mcp_server_name: serverName,
      default_config: { enabled: false },
      configs: {},
    };
    for (const toolName of connector.defaultReadTools) {
      toolset.configs[toolName] = { enabled: true };
    }
    if (live.writeAccess) {
      // Enable all tools; read tools stay on, writes become available.
      toolset.default_config = { enabled: true };
      toolset.configs = {};
    }
    tools.push(toolset);
  }

  return { mcp_servers: mcpServers, tools };
}

module.exports = {
  listConnections,
  beginConnect: beginConnectWithLookup,
  beginConnectRaw: beginConnect,
  completeConnect,
  disconnect,
  setWriteAccess,
  getValidAccessToken,
  buildAnthropicMcpAttachment,
  SYSTEM_USER,
  OAUTH_STATE_TTL_MS,
  WRITE_ACCESS_TTL_MS,
};
