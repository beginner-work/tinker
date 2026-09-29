/* Site content items, one row per site and slug.
 *
 * The table matches prisma/migrations/20260928220000_add_content_items.
 * Vercel builds do not run migrate deploy, so the first read or write
 * creates the same table if it is missing. Someone else's id returns
 * 404, not 403. A second create with the same draftKey, or the same
 * site and slug for this user, returns the existing row and does not
 * change it. Bots pass allowPublish false; status published is rejected
 * and nothing is written.
 *
 * Rows live in the existing Postgres (DATABASE_URL). No new service.
 */

"use strict";

const { MARISOL_SITE, marisolSeedItems } = require("./content-seed-marisol.js");

const TYPES = ["page_section", "product", "event", "post", "link"];
const STATUSES = ["draft", "published"];
const MAX_TITLE = 300;
const MAX_BODY = 100000;
const MAX_FIELDS = 200000;
const MAX_SLUG = 120;
const MAX_SITE = 253;
const MAX_NOTE = 200;
const MAX_KEY = 200;

const UNAVAILABLE = "Content store is unavailable right now.";

const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "ContentItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "site" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "fields" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL,
    "noteId" TEXT,
    "draftKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ContentItem_site_slug_key" ON "ContentItem"("site", "slug")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ContentItem_userId_draftKey_key" ON "ContentItem"("userId", "draftKey")`,
  `CREATE INDEX IF NOT EXISTS "ContentItem_userId_idx" ON "ContentItem"("userId")`,
  `CREATE INDEX IF NOT EXISTS "ContentItem_site_status_idx" ON "ContentItem"("site", "status")`,
];

let ensuring = null;

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

function isUniqueConflict(err) {
  return Boolean(err && (err.code === "P2002" || /unique/i.test(String(err.message || ""))));
}

function readSite(value) {
  if (typeof value !== "string" || !value.trim()) throw fail(400, "site is required.");
  let site = value.trim().toLowerCase();
  site = site.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!site || site.length > MAX_SITE) throw fail(400, "site must be a hostname.");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(site)) {
    throw fail(400, "site must be a hostname.");
  }
  return site;
}

function readType(value, explicit) {
  if (!explicit && (value == null || value === "")) {
    throw fail(400, "type must be page_section, product, event, post, or link.");
  }
  if (typeof value !== "string") {
    throw fail(400, "type must be page_section, product, event, post, or link.");
  }
  const type = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!TYPES.includes(type)) {
    throw fail(400, "type must be page_section, product, event, post, or link.");
  }
  return type;
}

function readSlug(value) {
  if (typeof value !== "string" || !value.trim()) throw fail(400, "slug is required.");
  const slug = value.trim().toLowerCase();
  if (slug.length > MAX_SLUG || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw fail(400, "slug must be lowercase letters, numbers, and hyphens.");
  }
  return slug;
}

function readTitle(value) {
  if (typeof value !== "string" || !value.trim()) throw fail(400, "title is required.");
  const title = value.trim();
  if (title.length > MAX_TITLE) throw fail(400, `title is limited to ${MAX_TITLE} characters.`);
  return title;
}

function readBody(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw fail(400, "body must be a string.");
  if (value.length > MAX_BODY) throw fail(400, `body is limited to ${MAX_BODY} characters.`);
  return value;
}

function readFields(value) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw fail(400, "fields must be an object.");
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw fail(400, "fields must be JSON.");
  }
  if (encoded.length > MAX_FIELDS) throw fail(400, `fields is limited to ${MAX_FIELDS} characters.`);
  return JSON.parse(encoded);
}

function readOptional(value, label, max) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw fail(400, `${label} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) throw fail(400, `${label} is limited to ${max} characters.`);
  return trimmed;
}

function readStatus(value, allowPublish) {
  if (value == null || value === "") return "draft";
  if (typeof value !== "string") throw fail(400, "status must be draft or published.");
  const status = value.trim().toLowerCase();
  if (!STATUSES.includes(status)) throw fail(400, "status must be draft or published.");
  if (status === "published" && !allowPublish) throw fail(403, "Bots cannot publish.");
  return status;
}

function iso(value) {
  return new Date(value).toISOString();
}

function fieldsOf(row) {
  if (row.fields && typeof row.fields === "object" && !Array.isArray(row.fields)) return row.fields;
  return {};
}

function presentOwner(row) {
  return {
    id: row.id,
    site: row.site,
    type: row.type,
    slug: row.slug,
    title: row.title,
    body: row.body,
    fields: fieldsOf(row),
    status: row.status,
    noteId: row.noteId || null,
    draftKey: row.draftKey || null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function presentPublic(row) {
  return {
    id: row.id,
    site: row.site,
    type: row.type,
    slug: row.slug,
    title: row.title,
    body: row.body,
    fields: fieldsOf(row),
    status: "published",
    updatedAt: iso(row.updatedAt),
  };
}

async function ensureTable() {
  if (ensuring) return ensuring;
  ensuring = (async () => {
    const prisma = db();
    for (const statement of TABLE_STATEMENTS) {
      await prisma.$executeRawUnsafe(statement);
    }
  })().catch((err) => {
    ensuring = null;
    throw Object.assign(new Error("Could not prepare the content table."), {
      status: 503,
      cause: err,
    });
  });
  return ensuring;
}

function resetTableCache() {
  ensuring = null;
}

async function loadOwned(id, userId) {
  if (typeof id !== "string" || !id.trim()) throw fail(400, "Content id is required.");
  let row;
  try {
    row = await db().contentItem.findUnique({ where: { id: id.trim() } });
  } catch (err) {
    throw storeDown(err);
  }
  if (!row || row.userId !== userId) throw fail(404, "No content item with that id.");
  return row;
}

async function findBySiteSlug(site, slug) {
  try {
    return await db().contentItem.findUnique({
      where: { site_slug: { site, slug } },
    });
  } catch (err) {
    throw storeDown(err);
  }
}

async function findByDraftKey(userId, draftKey) {
  try {
    return await db().contentItem.findUnique({
      where: { userId_draftKey: { userId, draftKey } },
    });
  } catch (err) {
    throw storeDown(err);
  }
}

async function findExisting(userId, site, slug, draftKey) {
  if (draftKey) {
    const byKey = await findByDraftKey(userId, draftKey);
    if (byKey) return byKey;
  }
  return findBySiteSlug(site, slug);
}

function ownedOrHidden(row, userId) {
  if (!row) return null;
  if (row.userId !== userId) throw fail(404, "No content item with that slug.");
  return row;
}

async function createContent({
  userId,
  site,
  type,
  slug,
  title,
  body,
  fields,
  noteId,
  draftKey,
  status,
  allowPublish,
}) {
  const owner = requireUserId(userId);
  const nextStatus = readStatus(status, Boolean(allowPublish));
  const data = {
    userId: owner,
    site: readSite(site),
    type: readType(type),
    slug: readSlug(slug),
    title: readTitle(title),
    body: readBody(body),
    fields: readFields(fields),
    status: nextStatus,
    noteId: readOptional(noteId, "noteId", MAX_NOTE),
    draftKey: readOptional(draftKey, "draftKey", MAX_KEY),
  };
  await ensureTable();
  const existing = ownedOrHidden(
    await findExisting(owner, data.site, data.slug, data.draftKey),
    owner,
  );
  if (existing) return { row: existing, created: false };
  try {
    const row = await db().contentItem.create({ data });
    return { row, created: true };
  } catch (err) {
    if (isUniqueConflict(err)) {
      const raced = ownedOrHidden(
        await findExisting(owner, data.site, data.slug, data.draftKey),
        owner,
      );
      if (raced) return { row: raced, created: false };
    }
    throw storeDown(err);
  }
}

async function listContent({ userId, site, type, status } = {}) {
  const owner = requireUserId(userId);
  const where = { userId: owner };
  if (site) where.site = readSite(site);
  if (type) where.type = readType(type, true);
  if (status) where.status = readStatus(status, true);
  await ensureTable();
  try {
    return await db().contentItem.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { slug: "asc" }],
    });
  } catch (err) {
    throw storeDown(err);
  }
}

async function getContent({ id, userId }) {
  const owner = requireUserId(userId);
  await ensureTable();
  return loadOwned(id, owner);
}

async function updateContent({ id, userId, patch, allowPublish }) {
  const owner = requireUserId(userId);
  const source = patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {};
  const keys = ["site", "type", "slug", "title", "body", "fields", "noteId", "status"].filter((key) =>
    Object.prototype.hasOwnProperty.call(source, key),
  );
  if (!keys.length) throw fail(400, "Nothing to update.");
  await ensureTable();
  const row = await loadOwned(id, owner);
  const data = {};
  if (Object.prototype.hasOwnProperty.call(source, "site")) data.site = readSite(source.site);
  if (Object.prototype.hasOwnProperty.call(source, "type")) data.type = readType(source.type, true);
  if (Object.prototype.hasOwnProperty.call(source, "slug")) data.slug = readSlug(source.slug);
  if (Object.prototype.hasOwnProperty.call(source, "title")) data.title = readTitle(source.title);
  if (Object.prototype.hasOwnProperty.call(source, "body")) data.body = readBody(source.body);
  if (Object.prototype.hasOwnProperty.call(source, "fields")) data.fields = readFields(source.fields);
  if (Object.prototype.hasOwnProperty.call(source, "noteId")) {
    data.noteId = readOptional(source.noteId, "noteId", MAX_NOTE);
  }
  if (Object.prototype.hasOwnProperty.call(source, "status")) {
    data.status = readStatus(source.status, Boolean(allowPublish));
  }

  const nextSite = data.site || row.site;
  const nextSlug = data.slug || row.slug;
  if (nextSite !== row.site || nextSlug !== row.slug) {
    const other = await findBySiteSlug(nextSite, nextSlug);
    if (other && other.id !== row.id) ownedOrHidden(other, owner);
    if (other && other.id !== row.id && other.userId === owner) {
      throw fail(409, "That slug is already used on this site.");
    }
  }

  if (!Object.keys(data).length) return row;
  try {
    return await db().contentItem.update({ where: { id: row.id }, data });
  } catch (err) {
    throw storeDown(err);
  }
}

async function listPublished({ site, type, slug } = {}) {
  const where = { site: readSite(site), status: "published" };
  if (type) where.type = readType(type, true);
  if (slug) where.slug = readSlug(slug);
  await ensureTable();
  try {
    return await db().contentItem.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { slug: "asc" }],
    });
  } catch (err) {
    throw storeDown(err);
  }
}

async function importMarisol({ userId, publish }) {
  const owner = requireUserId(userId);
  const allowPublish = Boolean(publish);
  const saved = [];
  for (const entry of marisolSeedItems()) {
    const result = await createContent({
      userId: owner,
      site: entry.site,
      type: entry.type,
      slug: entry.slug,
      title: entry.title,
      body: entry.body,
      fields: entry.fields,
      noteId: entry.noteId,
      draftKey: entry.draftKey,
      status: allowPublish ? "published" : "draft",
      allowPublish,
    });
    saved.push(result);
  }
  return saved;
}

module.exports = {
  TYPES,
  STATUSES,
  UNAVAILABLE,
  MARISOL_SITE,
  TABLE_STATEMENTS,
  ensureTable,
  resetTableCache,
  normalizeSite: readSite,
  presentOwner,
  presentPublic,
  createContent,
  listContent,
  getContent,
  updateContent,
  listPublished,
  importMarisol,
  marisolSeedItems,
  findByDraftKey,
};
