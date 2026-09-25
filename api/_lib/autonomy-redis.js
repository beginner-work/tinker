/* Per-user autonomy settings in Upstash Redis.
 *
 * One hash per signed-in user: autonomy:<stytch user id>. Each field
 * is an item key. The value is JSON
 * {autonomous, note, updated_by, updated_at}. A save is one HSET on
 * that field, after an HGET when the change has to keep the other
 * half. The REST URL and token are never placed on an error, a
 * response, or a log.
 */

"use strict";

const TIMEOUT_MS = 2000;
const UNAVAILABLE = "Autonomy settings are unavailable right now.";

function redisConfig() {
  const kvUrl = String(process.env.KV_REST_API_URL || "").trim();
  const kvToken = String(process.env.KV_REST_API_TOKEN || "").trim();
  if (kvUrl && kvToken) return { url: kvUrl, token: kvToken };
  const upstashUrl = String(process.env.UPSTASH_REDIS_REST_URL || "").trim();
  const upstashToken = String(process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  if (upstashUrl && upstashToken) return { url: upstashUrl, token: upstashToken };
  return null;
}

function unavailable() {
  return Object.assign(new Error(UNAVAILABLE), { status: 503 });
}

function hashKey(userId) {
  return "autonomy:" + userId;
}

async function command(args) {
  const config = redisConfig();
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

function parseStored(raw) {
  if (typeof raw !== "string" || !raw) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.autonomous !== "boolean") return null;
  if (typeof value.note !== "string") return null;
  if (!(value.updated_by === null || typeof value.updated_by === "string")) return null;
  if (!(value.updated_at === null || typeof value.updated_at === "string")) return null;
  return {
    autonomous: value.autonomous,
    note: value.note,
    updatedBy: value.updated_by,
    updatedAt: value.updated_at,
  };
}

function pairsFrom(result) {
  if (result == null) return [];
  if (Array.isArray(result)) {
    const pairs = [];
    for (let i = 0; i + 1 < result.length; i += 2) {
      pairs.push([result[i], result[i + 1]]);
    }
    return pairs;
  }
  if (typeof result === "object") return Object.entries(result);
  return [];
}

function blankValue() {
  return {
    autonomous: false,
    note: "",
    updatedBy: null,
    updatedAt: null,
  };
}

async function readAll(userId) {
  const result = await command(["HGETALL", hashKey(userId)]);
  const rows = new Map();
  for (const [field, raw] of pairsFrom(result)) {
    const parsed = parseStored(raw);
    if (parsed) rows.set(String(field), parsed);
  }
  return rows;
}

async function readField(userId, itemKey) {
  const result = await command(["HGET", hashKey(userId), itemKey]);
  if (result == null) return blankValue();
  return parseStored(result) || blankValue();
}

async function writeField(userId, itemKey, value) {
  const stored = {
    autonomous: value.autonomous,
    note: value.note,
    updated_by: value.updated_by,
    updated_at: value.updated_at,
  };
  await command(["HSET", hashKey(userId), itemKey, JSON.stringify(stored)]);
}

module.exports = {
  TIMEOUT_MS,
  UNAVAILABLE,
  redisConfig,
  hashKey,
  parseStored,
  readAll,
  readField,
  writeField,
};
