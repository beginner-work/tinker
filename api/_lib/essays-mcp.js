/* Read-only MCP access to the owner's Founder Source / Development essays.
 *
 * Source: synced user-data kind "essays" (same blob the writing UI saves).
 * Side labels: business → Founder Source, technical → Development.
 * Display titles use Title Case; stored titles are unchanged.
 * Never crosses owners. Does not write.
 */

"use strict";

const path = require("node:path");
const repoFolders = require("./repo-folders-store.js");
const storiesMd = require(path.join(
  __dirname,
  "..",
  "..",
  "src",
  "renderer",
  "lib",
  "stories-md.js"
));

const UNAVAILABLE = "Essays are unavailable right now.";
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const SIDE_BUSINESS = "business";
const SIDE_TECHNICAL = "technical";
const LABEL_FOUNDER_SOURCE = "Founder Source";
const LABEL_DEVELOPMENT = "Development";

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

function toIso(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : "";
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  }
  const s = String(value).trim();
  if (!s) return "";
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString() : s;
}

function wordCount(text) {
  const raw = String(text == null ? "" : text).trim();
  if (!raw) return 0;
  return raw.split(/\s+/).filter(Boolean).length;
}

/** Normalize optional side filter to business | technical. */
function normalizeSideFilter(side) {
  if (side == null || side === "") return null;
  const raw = String(side).trim().toLowerCase();
  if (raw === SIDE_BUSINESS || raw === "founder source" || raw === "founder_source") {
    return SIDE_BUSINESS;
  }
  if (raw === SIDE_TECHNICAL || raw === "development") {
    return SIDE_TECHNICAL;
  }
  throw fail(400, "side must be business or technical.");
}

/** Map stored contentType to the dual-sidebar side key. */
function sideKeyFromContentType(contentType) {
  const t = String(contentType == null ? "" : contentType).trim().toLowerCase();
  return t === SIDE_TECHNICAL ? SIDE_TECHNICAL : SIDE_BUSINESS;
}

function sideLabel(sideKey) {
  return sideKey === SIDE_TECHNICAL ? LABEL_DEVELOPMENT : LABEL_FOUNDER_SOURCE;
}

function storedTitleOf(essay) {
  if (!essay || essay.title == null) return "";
  return String(essay.title);
}

function displayTitleOf(essay) {
  const stored = storedTitleOf(essay).trim();
  if (stored) return storiesMd.titleCaseDisplay(stored) || stored;
  return storiesMd.displayTitle({
    title: essay && essay.title,
    body: essay && essay.body,
    markdown: essay && essay.markdown,
    fileName: essay && essay.fileName,
    relPath: essay && essay.relPath,
  });
}

async function readUserBlob(userId, kind) {
  const prisma = db();
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind } },
  });
  return row && row.data != null ? row.data : null;
}

function presentListItem(essay) {
  const sideKey = sideKeyFromContentType(essay.contentType);
  const storedTitle = storedTitleOf(essay);
  const body = String(essay.body == null ? "" : essay.body);
  const created = toIso(essay.createdAt) || new Date(0).toISOString();
  const updated = toIso(essay.updatedAt) || created;
  return {
    id: String(essay.id || ""),
    title: displayTitleOf(essay),
    storedTitle,
    side: sideLabel(sideKey),
    createdAt: created,
    updatedAt: updated,
    wordCount: wordCount(body),
  };
}

function presentFull(essay) {
  const listed = presentListItem(essay);
  return Object.assign({}, listed, {
    body: String(essay.body == null ? "" : essay.body),
  });
}

function attachEssayTypes(essays, folderBlob) {
  try {
    const tree = repoFolders.normalizeState(folderBlob);
    return repoFolders.attachTypes(essays, tree);
  } catch {
    return (Array.isArray(essays) ? essays : []).map((row) => Object.assign({}, row, {
      folderId: null,
      contentType: row && row.contentType
        ? String(row.contentType).trim().toLowerCase() || "business"
        : "business",
    }));
  }
}

async function loadOwnerEssays(userId) {
  const uid = requireUserId(userId);
  const [essaysData, folderBlob] = await Promise.all([
    readUserBlob(uid, "essays"),
    readUserBlob(uid, "repo_folders").catch(() => null),
  ]);
  const rows = Array.isArray(essaysData) ? essaysData : [];
  const withBody = rows.filter((essay) => essay && essay.id && String(essay.body || "").trim());
  return attachEssayTypes(withBody, folderBlob);
}

/** All Founder Source essays with body (no MCP list limit). Newest first. */
async function listFounderSourceEssaysFull({ userId } = {}) {
  try {
    const essays = await loadOwnerEssays(userId);
    const filtered = essays.filter(
      (e) => sideKeyFromContentType(e.contentType) === SIDE_BUSINESS,
    );
    filtered.sort((a, b) => {
      const tb = Date.parse(toIso(b.updatedAt) || toIso(b.createdAt)) || 0;
      const ta = Date.parse(toIso(a.updatedAt) || toIso(a.createdAt)) || 0;
      if (tb !== ta) return tb - ta;
      return String(b.id).localeCompare(String(a.id));
    });
    return filtered.map(presentFull);
  } catch (err) {
    throw storeDown(err);
  }
}

async function listEssays({ userId, side, limit } = {}) {
  try {
    const sideKey = normalizeSideFilter(side);
    const cap = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const essays = await loadOwnerEssays(userId);
    const filtered = sideKey
      ? essays.filter((e) => sideKeyFromContentType(e.contentType) === sideKey)
      : essays;

    filtered.sort((a, b) => {
      const tb = Date.parse(toIso(b.updatedAt) || toIso(b.createdAt)) || 0;
      const ta = Date.parse(toIso(a.updatedAt) || toIso(a.createdAt)) || 0;
      if (tb !== ta) return tb - ta;
      return String(b.id).localeCompare(String(a.id));
    });

    return filtered.slice(0, cap).map(presentListItem);
  } catch (err) {
    throw storeDown(err);
  }
}

async function readEssay({ userId, id } = {}) {
  try {
    const uid = requireUserId(userId);
    const essayId = String(id == null ? "" : id).trim();
    if (!essayId) throw fail(400, "id is required.");
    const essays = await loadOwnerEssays(uid);
    const hit = essays.find((e) => String(e.id) === essayId);
    if (!hit) throw fail(404, "Essay not found.");
    return presentFull(hit);
  } catch (err) {
    throw storeDown(err);
  }
}

module.exports = {
  UNAVAILABLE,
  MAX_LIMIT,
  DEFAULT_LIMIT,
  SIDE_BUSINESS,
  SIDE_TECHNICAL,
  LABEL_FOUNDER_SOURCE,
  LABEL_DEVELOPMENT,
  listEssays,
  listFounderSourceEssaysFull,
  readEssay,
  loadOwnerEssays,
  titleCaseDisplay: storiesMd.titleCaseDisplay,
  wordCount,
  sideLabel,
  sideKeyFromContentType,
  normalizeSideFilter,
};
