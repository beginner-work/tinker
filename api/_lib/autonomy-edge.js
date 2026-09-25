/* Vercel Edge Config storage for autonomy toggles.
 *
 * One item per key, named autonomy_<key>. Reads use getAll from
 * @vercel/edge-config and the EDGE_CONFIG connection string. Writes
 * are a single-item upsert so one save cannot replace another item.
 * The write token is never placed on an error, a response, or a log.
 */

"use strict";

const { getAll } = require("@vercel/edge-config");
const { AUTONOMY_ITEMS } = require("./autonomy.js");

const WRITE_URL = "https://api.vercel.com/v1/edge-config";
const LAST_DENIED_KEY = "autonomy_last_denied";
const DENIED_WINDOW_MS = 10 * 60 * 1000;

function edgeKey(key) {
  return "autonomy_" + key;
}

function edgeKeys() {
  return AUTONOMY_ITEMS.map((item) => edgeKey(item.key));
}

function blankValue() {
  return {
    autonomous: false,
    note: "",
    updated_by: null,
    updated_at: null,
  };
}

function notReady() {
  return Object.assign(new Error("Autonomy settings are not ready."), { status: 503 });
}

function parseValue(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.autonomous !== "boolean") return null;
  if (typeof value.note !== "string") return null;
  if (!(value.updated_by === null || typeof value.updated_by === "string")) return null;
  if (!(value.updated_at === null || typeof value.updated_at === "string")) return null;
  return {
    autonomous: value.autonomous,
    note: value.note,
    updated_by: value.updated_by,
    updated_at: value.updated_at,
  };
}

function rowFromValue(value) {
  const parsed = parseValue(value);
  if (!parsed) return null;
  return {
    autonomous: parsed.autonomous,
    note: parsed.note,
    updatedBy: parsed.updated_by,
    updatedAt: parsed.updated_at,
  };
}

async function readItems(names) {
  if (!String(process.env.EDGE_CONFIG || "").trim()) return null;
  try {
    const raw = await getAll(names);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

async function readAll() {
  return readItems(edgeKeys());
}

async function readOne(key) {
  const name = edgeKey(key);
  const raw = await readItems([name]);
  if (!raw) throw notReady();
  if (!Object.prototype.hasOwnProperty.call(raw, name) || raw[name] == null) {
    return blankValue();
  }
  return parseValue(raw[name]) || blankValue();
}

function writeUrl() {
  const id = String(process.env.EDGE_CONFIG_ID || "").trim();
  const token = String(process.env.EDGE_CONFIG_WRITE_TOKEN || "").trim();
  if (!id || !token) throw notReady();
  const url = new URL(`${WRITE_URL}/${encodeURIComponent(id)}/items`);
  const team = String(process.env.VERCEL_TEAM_ID || "").trim();
  if (team) url.searchParams.set("teamId", team);
  return { url, token };
}

function recentDenial(value, userId, now) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.user_id !== userId || typeof value.at !== "string") return false;
  const then = Date.parse(value.at);
  if (Number.isNaN(then)) return false;
  const age = now - then;
  return age >= 0 && age < DENIED_WINDOW_MS;
}

async function rememberDenied(userId) {
  const now = new Date();
  const raw = await readItems([LAST_DENIED_KEY]);
  const current = raw && raw[LAST_DENIED_KEY];
  if (recentDenial(current, userId, now.getTime())) return false;
  await upsertEdgeItem(LAST_DENIED_KEY, {
    user_id: userId,
    at: now.toISOString(),
  });
  return true;
}

async function upsertEdgeItem(name, value) {
  const { url, token } = writeUrl();
  let response;
  try {
    response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        items: [{ operation: "upsert", key: name, value }],
      }),
    });
  } catch {
    throw notReady();
  }
  try {
    await response.arrayBuffer();
  } catch {
    /* the status is enough */
  }
  if (!response.ok) throw notReady();
}

module.exports = {
  edgeKey,
  edgeKeys,
  blankValue,
  parseValue,
  rowFromValue,
  LAST_DENIED_KEY,
  readAll,
  readOne,
  rememberDenied,
  upsertEdgeItem,
};
