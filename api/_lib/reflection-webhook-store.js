/* Per-owner reflection webhook secrets (URL + Authorization), encrypted at rest. */
"use strict";
const { encrypt, decrypt, maskSecret } = require("./secrets-crypto.js");
const KIND = "reflection_webhook";
const UNAVAILABLE = "Reflection webhook settings are unavailable right now.";
function db() { return require("./db.js"); }
function fail(status, message) { return Object.assign(new Error(message), { status }); }
function requireUserId(userId) {
  if (typeof userId !== "string" || !userId.trim()) throw fail(401, "Sign in to tinker first.");
  return userId.trim();
}
function storeDown(err) {
  if (err && err.status) return err;
  return Object.assign(new Error(UNAVAILABLE), { status: 503, cause: err });
}
function presentPublic(data) {
  const row = data && typeof data === "object" ? data : null;
  const configured = !!(row && row.urlEnc && row.authEnc);
  return {
    configured,
    urlHint: configured ? String(row.urlHint || "••••") : "",
    authorizationHint: configured ? String(row.authorizationHint || "••••") : "",
    updatedAt: row && row.updatedAt ? String(row.updatedAt) : null,
  };
}
async function readRaw(userId) {
  const row = await db().tinkerUserData.findUnique({ where: { userId_kind: { userId, kind: KIND } } });
  return row && row.data && typeof row.data === "object" ? row.data : null;
}
async function writeRaw(userId, data) {
  await db().tinkerUserData.upsert({
    where: { userId_kind: { userId, kind: KIND } },
    create: { userId, kind: KIND, data },
    update: { data },
  });
}
function trimUrl(value) {
  const url = String(value == null ? "" : value).trim();
  if (!url) throw fail(400, "url is required.");
  let parsed;
  try { parsed = new URL(url); } catch { throw fail(400, "url must be a valid https URL."); }
  if (parsed.protocol !== "https:") throw fail(400, "url must be https.");
  return parsed.toString();
}
function trimAuthorization(value) {
  const auth = String(value == null ? "" : value).trim();
  if (!auth) throw fail(400, "authorization is required.");
  if (auth.length > 4000) throw fail(400, "authorization is too long.");
  return auth;
}
async function getPublic({ userId } = {}) {
  try { return presentPublic(await readRaw(requireUserId(userId))); }
  catch (err) { throw storeDown(err); }
}
async function setWebhook({ userId, url, authorization } = {}) {
  try {
    const uid = requireUserId(userId);
    const cleanUrl = trimUrl(url);
    const cleanAuth = trimAuthorization(authorization);
    const prev = (await readRaw(uid)) || {};
    const data = {
      urlEnc: encrypt(cleanUrl),
      authEnc: encrypt(cleanAuth),
      urlHint: maskSecret(cleanUrl),
      authorizationHint: maskSecret(cleanAuth),
      updatedAt: new Date().toISOString(),
      lastPingAt: prev.lastPingAt || null,
      pending: prev.pending || null,
    };
    await writeRaw(uid, data);
    return presentPublic(data);
  } catch (err) { throw storeDown(err); }
}
async function clearWebhook({ userId } = {}) {
  try {
    const uid = requireUserId(userId);
    await writeRaw(uid, {
      urlEnc: null, authEnc: null, urlHint: "", authorizationHint: "",
      updatedAt: new Date().toISOString(), lastPingAt: null, pending: null,
    });
    return presentPublic(null);
  } catch (err) { throw storeDown(err); }
}
async function getSecrets({ userId } = {}) {
  try {
    const data = await readRaw(requireUserId(userId));
    if (!data || !data.urlEnc || !data.authEnc) return null;
    return {
      url: decrypt(data.urlEnc),
      authorization: decrypt(data.authEnc),
      lastPingAt: data.lastPingAt || null,
      pending: data.pending || null,
    };
  } catch (err) { throw storeDown(err); }
}
async function patchMeta({ userId, lastPingAt, pending } = {}) {
  try {
    const uid = requireUserId(userId);
    const data = (await readRaw(uid)) || {};
    if (!data.urlEnc) return;
    const next = Object.assign({}, data);
    if (lastPingAt !== undefined) next.lastPingAt = lastPingAt;
    if (pending !== undefined) next.pending = pending;
    await writeRaw(uid, next);
  } catch (err) { throw storeDown(err); }
}
module.exports = {
  KIND, UNAVAILABLE, getPublic, setWebhook, clearWebhook, getSecrets, patchMeta, presentPublic, maskSecret,
};
