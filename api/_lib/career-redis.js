/* Per-user career record in Upstash Redis.
 *
 * One string per signed-in user: career:<stytch user id>. The value is
 * JSON {facts, rules}. Reads use KV_REST_API_URL with
 * KV_REST_API_READ_ONLY_TOKEN. Writes use KV_REST_API_URL with
 * KV_REST_API_TOKEN. The REST URL and tokens are never placed on an
 * error, a response, or a log.
 */

"use strict";

const TIMEOUT_MS = 2000;
const UNAVAILABLE = "Career record is unavailable right now.";

function pair(urlName, tokenName) {
  const url = String(process.env[urlName] || "").trim();
  const token = String(process.env[tokenName] || "").trim();
  if (!url || !token) return null;
  return { url, token };
}

function readConfig() {
  return pair("KV_REST_API_URL", "KV_REST_API_READ_ONLY_TOKEN");
}

function writeConfig() {
  return pair("KV_REST_API_URL", "KV_REST_API_TOKEN");
}

function unavailable() {
  return Object.assign(new Error(UNAVAILABLE), { status: 503 });
}

function recordKey(userId) {
  return "career:" + userId;
}

async function command(config, args) {
  if (!config) throw unavailable();
  let response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + config.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw unavailable();
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok || !payload || typeof payload !== "object" || payload.error) {
    throw unavailable();
  }
  return payload.result;
}

async function readRaw(userId) {
  return command(readConfig(), ["GET", recordKey(userId)]);
}

async function readRawForWrite(userId) {
  return command(writeConfig(), ["GET", recordKey(userId)]);
}

async function writeRaw(userId, json) {
  await command(writeConfig(), ["SET", recordKey(userId), json]);
}

async function createRaw(userId, json) {
  const result = await command(writeConfig(), ["SET", recordKey(userId), json, "NX"]);
  return result != null;
}

module.exports = {
  TIMEOUT_MS,
  UNAVAILABLE,
  readConfig,
  writeConfig,
  recordKey,
  readRaw,
  readRawForWrite,
  writeRaw,
  createRaw,
};
