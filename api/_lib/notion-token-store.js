/* Per-user Notion public-integration access tokens in Postgres (TinkerUserData).
 *
 * Kind keys:
 *   notion_api_oauth              — encrypted access token for that user
 *   notion_api_oauth_state:<hash> — short-lived OAuth state (user + SYSTEM lookup)
 *
 * Uses the same encrypt/decrypt path as Connections (TINKER_SECRETS_KEY).
 * Not Upstash. Distinct from the outbound MCP Notion connector tokens.
 */

"use strict";

const { encrypt, decrypt } = require("./secrets-crypto.js");
const oauth = require("./notion-oauth.js");

const KIND = "notion_api_oauth";
const SYSTEM_USER = "__tinker_system__";
const UNAVAILABLE = "Notion connection store is unavailable right now.";

function db() {
  return require("./db.js");
}

function fail(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function requireUserId(userId) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw fail(401, "Sign in to tinker first.");
  }
  return userId.trim();
}

function stateKind(stateHash) {
  return "notion_api_oauth_state:" + String(stateHash);
}

function storeDown(err) {
  if (err && err.status) return err;
  return Object.assign(new Error(UNAVAILABLE), { status: 503, cause: err });
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

function presentPublic(row) {
  const connected = !!(row && row.accessTokenEnc);
  return {
    connected,
    configured: oauth.isConfigured(),
    connectedAt: connected && row.connectedAt ? String(row.connectedAt) : null,
    workspaceName: connected && row.workspaceName ? String(row.workspaceName) : null,
    workspaceId: connected && row.workspaceId ? String(row.workspaceId) : null,
    parentPageId: connected && row.parentPageId ? String(row.parentPageId) : null,
    essaysDatabaseId: connected && row.essaysDatabaseId ? String(row.essaysDatabaseId) : null,
  };
}

async function getStatus({ userId } = {}) {
  try {
    const uid = requireUserId(userId);
    const row = await readRaw(uid, KIND);
    return presentPublic(row);
  } catch (err) {
    throw storeDown(err);
  }
}

async function beginConnect({ userId } = {}) {
  try {
    const uid = requireUserId(userId);
    const config = oauth.requireConfig();
    // Signed state embeds userId so the OAuth callback (in-app browser sheet
    // or Safari) can finish without a Tinker session cookie/Bearer header.
    const state = oauth.createSignedState({ userId: uid });
    const stateHash = oauth.hashState(state);
    const verified = oauth.verifySignedState(state);
    const expiresAt = new Date(verified.exp).toISOString();

    await writeRaw(uid, stateKind(stateHash), {
      redirectUri: config.redirectUri,
      expiresAt,
      nonce: verified.nonce,
    });
    // One-time SYSTEM row blocks replay even if the signed blob is stolen.
    await writeRaw(SYSTEM_USER, stateKind(stateHash), {
      userId: uid,
      expiresAt,
      nonce: verified.nonce,
    });

    const authorizeUrl = oauth.buildAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
    });

    return { authorizeUrl, expiresAt };
  } catch (err) {
    throw storeDown(err);
  }
}

async function completeConnect({ code, state, fetchImpl } = {}) {
  try {
    if (typeof code !== "string" || !code.trim()) {
      throw fail(400, "Missing OAuth code.", "notion_oauth_missing_code");
    }
    // Identity comes from the signed state, not from cookies / Authorization.
    const verified = oauth.verifySignedState(state);
    const userId = verified.userId;
    const stateHash = oauth.hashState(String(state).trim());
    const kind = stateKind(stateHash);

    const lookup = await readRaw(SYSTEM_USER, kind);
    const pending = await readRaw(userId, kind);
    const lookupUser = lookup && lookup.userId ? String(lookup.userId) : "";

    if (!pending || !lookup || lookupUser !== userId) {
      throw fail(
        400,
        "OAuth state expired or unknown. Start Connect Notion again.",
        "notion_oauth_bad_state",
      );
    }
    if (pending.expiresAt && Date.parse(pending.expiresAt) <= Date.now()) {
      await deleteRaw(userId, kind);
      await deleteRaw(SYSTEM_USER, kind);
      throw fail(400, "OAuth state expired. Start Connect Notion again.", "notion_oauth_state_expired");
    }

    const config = oauth.requireConfig();
    if (pending.redirectUri && pending.redirectUri !== config.redirectUri) {
      throw fail(400, "OAuth redirect URI mismatch.", "notion_oauth_redirect_mismatch");
    }

    const token = await oauth.exchangeCode({
      code: code.trim(),
      redirectUri: config.redirectUri,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      fetchImpl,
    });

    const connectedAt = new Date().toISOString();
    await writeRaw(userId, KIND, {
      accessTokenEnc: encrypt(token.accessToken),
      tokenType: token.tokenType,
      botId: token.botId,
      workspaceId: token.workspaceId,
      workspaceName: token.workspaceName,
      workspaceIcon: token.workspaceIcon,
      connectedAt,
      updatedAt: connectedAt,
    });
    await deleteRaw(userId, kind);
    await deleteRaw(SYSTEM_USER, kind);

    return {
      userId,
      status: presentPublic({
        accessTokenEnc: "x",
        connectedAt,
        workspaceName: token.workspaceName,
        workspaceId: token.workspaceId,
      }),
    };
  } catch (err) {
    throw storeDown(err);
  }
}

async function disconnect({ userId } = {}) {
  try {
    const uid = requireUserId(userId);
    await deleteRaw(uid, KIND);
    return presentPublic(null);
  } catch (err) {
    throw storeDown(err);
  }
}

async function getAccessToken({ userId } = {}) {
  try {
    const uid = requireUserId(userId);
    const row = await readRaw(uid, KIND);
    if (!row || !row.accessTokenEnc) {
      throw fail(400, "Connect Notion from the writing app first.", "notion_not_connected");
    }
    return {
      accessToken: decrypt(row.accessTokenEnc),
      workspaceId: row.workspaceId ? String(row.workspaceId) : "",
      workspaceName: row.workspaceName ? String(row.workspaceName) : "",
    };
  } catch (err) {
    throw storeDown(err);
  }
}

async function getSettings({ userId } = {}) {
  try {
    const uid = requireUserId(userId);
    const row = await readRaw(uid, KIND);
    if (!row || !row.accessTokenEnc) {
      throw fail(400, "Connect Notion from the writing app first.", "notion_not_connected");
    }
    return {
      parentPageId: row.parentPageId ? String(row.parentPageId) : "",
      essaysDatabaseId: row.essaysDatabaseId ? String(row.essaysDatabaseId) : "",
    };
  } catch (err) {
    throw storeDown(err);
  }
}

function normalizeParentPageId(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) throw fail(400, "parentPageId is required.", "notion_parent_required");
  const hex = s.replace(/-/g, "");
  const fromUrl = s.match(/([a-f0-9]{32})(?:\?|#|$)/i);
  const idHex = fromUrl ? fromUrl[1] : /^[a-f0-9]{32}$/i.test(hex) ? hex : "";
  if (!idHex) {
    if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s)) {
      return s.toLowerCase();
    }
    throw fail(400, "parentPageId must be a Notion page id or page URL.", "notion_parent_invalid");
  }
  const h = idHex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function setParentPage({ userId, parentPageId } = {}) {
  try {
    const uid = requireUserId(userId);
    const row = await readRaw(uid, KIND);
    if (!row || !row.accessTokenEnc) {
      throw fail(400, "Connect Notion from the writing app first.", "notion_not_connected");
    }
    const id = normalizeParentPageId(parentPageId);
    const next = Object.assign({}, row, {
      parentPageId: id,
      // New parent means the Essays DB must be re-resolved.
      essaysDatabaseId: "",
      updatedAt: new Date().toISOString(),
    });
    await writeRaw(uid, KIND, next);
    return presentPublic(next);
  } catch (err) {
    throw storeDown(err);
  }
}

async function setEssaysDatabaseId({ userId, essaysDatabaseId } = {}) {
  try {
    const uid = requireUserId(userId);
    const row = await readRaw(uid, KIND);
    if (!row || !row.accessTokenEnc) {
      throw fail(400, "Connect Notion from the writing app first.", "notion_not_connected");
    }
    const next = Object.assign({}, row, {
      essaysDatabaseId: String(essaysDatabaseId || "").trim(),
      updatedAt: new Date().toISOString(),
    });
    await writeRaw(uid, KIND, next);
    return presentPublic(next);
  } catch (err) {
    throw storeDown(err);
  }
}

module.exports = {
  KIND,
  SYSTEM_USER,
  UNAVAILABLE,
  getStatus,
  beginConnect,
  completeConnect,
  disconnect,
  getAccessToken,
  getSettings,
  setParentPage,
  setEssaysDatabaseId,
  isConfigured: oauth.isConfigured,
};
