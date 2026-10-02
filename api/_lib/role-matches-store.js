/* Role matches for the Lindow Labs overview.
 *
 * One TinkerUserData row per user, kind "role_matches". Bots upsert via
 * MCP save_role_match (by postingUrl). The overview lists open matches;
 * the owner can dismiss from the UI. Separate from job_applications.
 */

"use strict";

const crypto = require("crypto");

const KIND = "role_matches";
const UNAVAILABLE = "Role matches are unavailable right now.";
const MAX_COMPANY = 200;
const MAX_TITLE = 200;
const MAX_URL = 2000;
const MAX_LOCATION = 200;
const MAX_FIT = 400;
const MAX_ROLES = 120;

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

function storeDown(err) {
  if (err && err.status) return err;
  return Object.assign(new Error(UNAVAILABLE), { status: 503, cause: err });
}

function newRoleId() {
  return "role_" + crypto.randomBytes(8).toString("hex");
}

function trimText(value, label, max, required) {
  const text = String(value == null ? "" : value).trim();
  if (!text) {
    if (required) throw fail(400, label + " is required.");
    return "";
  }
  if (text.length > max) throw fail(400, label + " is too long.");
  return text;
}

function normalizeUrl(value, label) {
  const text = trimText(value, label, MAX_URL, true);
  if (!/^https?:\/\//i.test(text)) {
    throw fail(400, label + " must start with http:// or https://.");
  }
  return text;
}

function normalizePostingKey(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    let path = u.pathname || "/";
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    u.pathname = path;
    return u.toString().toLowerCase();
  } catch {
    return String(url || "").trim().toLowerCase();
  }
}

function presentRole(role) {
  return {
    id: role.id,
    company: role.company || "",
    title: role.title || "",
    postingUrl: role.postingUrl || "",
    location: role.location || "",
    fitReason: role.fitReason || "",
    savedAt: role.savedAt || role.createdAt || null,
    dismissedAt: role.dismissedAt || null,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

async function readBlob(userId) {
  const prisma = db();
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind: KIND } },
  });
  const data = row && row.data && typeof row.data === "object" ? row.data : {};
  const roles = Array.isArray(data.roles) ? data.roles : [];
  return { roles, updatedAt: row ? row.updatedAt : null };
}

async function writeBlob(userId, roles) {
  const prisma = db();
  const data = { roles };
  await prisma.tinkerUserData.upsert({
    where: { userId_kind: { userId, kind: KIND } },
    create: { userId, kind: KIND, data },
    update: { data },
  });
}

function findByPosting(roles, postingUrl) {
  const key = normalizePostingKey(postingUrl);
  return roles.find((row) => row && normalizePostingKey(row.postingUrl) === key) || null;
}

function findById(roles, roleId) {
  const id = String(roleId || "").trim();
  if (!id) throw fail(400, "roleId is required.");
  const role = roles.find((row) => row && row.id === id);
  if (!role) throw fail(404, "Role match not found.");
  return role;
}

async function saveRoleMatch({
  userId,
  company,
  title,
  postingUrl,
  location,
  fitReason,
} = {}) {
  try {
    const uid = requireUserId(userId);
    const companyName = trimText(company, "company", MAX_COMPANY, true);
    const roleTitle = trimText(title, "title", MAX_TITLE, true);
    const url = normalizeUrl(postingUrl, "postingUrl");
    const loc = trimText(location, "location", MAX_LOCATION, false);
    const fit = trimText(fitReason, "fitReason", MAX_FIT, false);
    const now = new Date().toISOString();
    const { roles } = await readBlob(uid);
    let role = findByPosting(roles, url);
    if (role) {
      role.company = companyName;
      role.title = roleTitle;
      role.postingUrl = url;
      role.location = loc;
      role.fitReason = fit;
      role.dismissedAt = null;
      role.savedAt = now;
      role.updatedAt = now;
    } else {
      role = {
        id: newRoleId(),
        company: companyName,
        title: roleTitle,
        postingUrl: url,
        location: loc,
        fitReason: fit,
        savedAt: now,
        dismissedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      roles.push(role);
      while (roles.length > MAX_ROLES) roles.shift();
    }
    await writeBlob(uid, roles);
    return presentRole(role);
  } catch (err) {
    throw storeDown(err);
  }
}

async function listRoleMatches({ userId, includeDismissed } = {}) {
  try {
    const uid = requireUserId(userId);
    const { roles } = await readBlob(uid);
    const rows = includeDismissed
      ? roles
      : roles.filter((row) => row && !row.dismissedAt);
    return rows
      .slice()
      .sort((a, b) => String(b.savedAt || b.createdAt || "").localeCompare(String(a.savedAt || a.createdAt || "")))
      .map(presentRole);
  } catch (err) {
    throw storeDown(err);
  }
}

async function dismissRoleMatch({ userId, roleId, postingUrl } = {}) {
  try {
    const uid = requireUserId(userId);
    const { roles } = await readBlob(uid);
    let role = null;
    if (roleId) role = findById(roles, roleId);
    else if (postingUrl) {
      role = findByPosting(roles, postingUrl);
      if (!role) throw fail(404, "Role match not found.");
    } else {
      throw fail(400, "roleId or postingUrl is required.");
    }
    const now = new Date().toISOString();
    role.dismissedAt = now;
    role.updatedAt = now;
    await writeBlob(uid, roles);
    return presentRole(role);
  } catch (err) {
    throw storeDown(err);
  }
}

module.exports = {
  KIND,
  UNAVAILABLE,
  MAX_COMPANY,
  MAX_TITLE,
  MAX_URL,
  MAX_LOCATION,
  MAX_FIT,
  presentRole,
  saveRoleMatch,
  listRoleMatches,
  dismissRoleMatch,
};
