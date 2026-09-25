/* Autonomy catalog and response shapes.
 *
 * Labels, descriptions, order, and the send note live in
 * src/renderer/autonomy/catalog.js. The autonomy page and
 * get_autonomy_settings both read that file. It does not hold a
 * read-time default for autonomous. Stored values live in one Redis
 * hash per signed-in user. A missing item or a bad value is not
 * autonomous. GET turns a store error into that same closed list.
 * The connector tool does not: a store error stays an error.
 */

"use strict";

const { SEND_NOTE, AUTONOMY_ITEMS } = require("../../src/renderer/autonomy/catalog.js");

const NOTE_MAX = 500;

const BY_KEY = new Map(AUTONOMY_ITEMS.map((item) => [item.key, item]));

function itemFor(key) {
  return BY_KEY.get(key) || null;
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function closedItem(def) {
  const item = {
    key: def.key,
    label: def.label,
    autonomous: false,
    note: null,
    updated_by: null,
    updated_at: null,
  };
  if (def.send_note) item.send_note = def.send_note;
  return item;
}

function shapeItem(def, row) {
  if (!row) return closedItem(def);
  const note = row.note && String(row.note).trim() ? String(row.note) : null;
  const item = {
    key: def.key,
    label: def.label,
    autonomous: Boolean(row.autonomous),
    note,
    updated_by: row.updatedBy ? String(row.updatedBy) : null,
    updated_at: row.updatedAt ? iso(row.updatedAt) : null,
  };
  if (def.send_note) item.send_note = def.send_note;
  return item;
}

function shapeList(rows) {
  const byKey = new Map();
  for (const row of rows || []) {
    if (row && row.key) byKey.set(row.key, row);
  }
  return {
    default_if_missing: "not_autonomous",
    items: AUTONOMY_ITEMS.map((def) => shapeItem(def, byKey.get(def.key) || null)),
  };
}

function closedList() {
  return {
    default_if_missing: "not_autonomous",
    items: AUTONOMY_ITEMS.map((def) => closedItem(def)),
  };
}

function toolItem(def, row) {
  const item = {
    key: def.key,
    label: def.label,
    description: def.description,
    on: Boolean(row && row.autonomous),
    updated_at: row && row.updatedAt ? iso(row.updatedAt) : null,
  };
  if (def.send_note) item.send_note = def.send_note;
  return item;
}

function toolSettings(rows) {
  const byKey = rows instanceof Map ? rows : new Map();
  if (!(rows instanceof Map)) {
    for (const row of rows || []) {
      if (row && row.key) byKey.set(row.key, row);
    }
  }
  return {
    settings: AUTONOMY_ITEMS.map((def) => toolItem(def, byKey.get(def.key) || null)),
  };
}

function sessionIdentity(session) {
  const user = (session && session.user) || {};
  const userId =
    (session && session.session && session.session.user_id) ||
    user.user_id ||
    "";
  const emails = [];
  const rawEmails = Array.isArray(user.emails) ? user.emails : [];
  for (const entry of rawEmails) {
    const email = typeof entry === "string" ? entry : entry && entry.email;
    if (typeof email === "string" && email.trim()) emails.push(email.trim());
  }
  const name = user.name || {};
  return {
    userId: String(userId || ""),
    emails,
    firstName: typeof name.first_name === "string" ? name.first_name.trim() : "",
    lastName: typeof name.last_name === "string" ? name.last_name.trim() : "",
  };
}

function callerFromSession(session) {
  const identity = sessionIdentity(session);
  if (!identity.userId) {
    throw Object.assign(new Error("Session missing user id."), { status: 401 });
  }
  let updatedBy = identity.userId;
  if (identity.emails.length) updatedBy = identity.emails[0];
  else {
    const named = [identity.firstName, identity.lastName].filter(Boolean).join(" ");
    if (named) updatedBy = named;
  }
  return {
    userId: identity.userId,
    updatedBy: updatedBy.slice(0, 80),
  };
}

function parseNote(value) {
  if (typeof value !== "string") {
    throw Object.assign(new Error("Note must be a string."), { status: 400 });
  }
  const trimmed = value.trim();
  if (trimmed.length > NOTE_MAX) {
    throw Object.assign(new Error("Note must be 500 characters or fewer."), { status: 400 });
  }
  return trimmed ? trimmed : null;
}

module.exports = {
  SEND_NOTE,
  NOTE_MAX,
  AUTONOMY_ITEMS,
  itemFor,
  shapeItem,
  shapeList,
  closedList,
  toolSettings,
  sessionIdentity,
  callerFromSession,
  parseNote,
};
