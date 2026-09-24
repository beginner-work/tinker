/* Saved LinkedIn drafts (posts and DMs), one row per draft.
 *
 * The table matches prisma/migrations/20260924190000_add_linkedin_drafts.
 * Vercel builds do not run migrate deploy, so the first list or save
 * creates the same table if it is missing. Updates load one row, check
 * userId, then update that id. Not a bulk update.
 *
 * This stores copy and a schedule. It does not post to LinkedIn.
 */

"use strict";

const STATUSES = ["draft", "approved", "scheduled", "posted"];
const MAX_TEXT = 8000;

const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "LinkedInDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkedInDraft_pkey" PRIMARY KEY ("id")
)`,
  `CREATE INDEX IF NOT EXISTS "LinkedInDraft_userId_idx" ON "LinkedInDraft"("userId")`,
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
  return Object.assign(new Error("LinkedIn draft store unavailable."), { status: 503, cause: err });
}

function readBody(value) {
  if (typeof value !== "string" || !value.trim()) throw fail(400, "Draft text is required.");
  const trimmed = value.trim();
  if (trimmed.length > MAX_TEXT) throw fail(400, `Draft text is limited to ${MAX_TEXT} characters.`);
  return trimmed;
}

function readNotes(value) {
  if (value == null || value === "") return "";
  if (typeof value !== "string") throw fail(400, "notes must be a string.");
  const trimmed = value.trim();
  if (trimmed.length > MAX_TEXT) throw fail(400, `notes is limited to ${MAX_TEXT} characters.`);
  return trimmed;
}

function readKind(value, explicit) {
  if (!explicit && (value == null || value === "")) return "post";
  if (typeof value !== "string") throw fail(400, 'kind must be "post" or "dm".');
  const kind = value.trim().toLowerCase();
  if (kind !== "post" && kind !== "dm") throw fail(400, 'kind must be "post" or "dm".');
  return kind;
}

function readStatus(value) {
  if (typeof value !== "string") {
    throw fail(400, "status must be draft, approved, scheduled, or posted.");
  }
  const status = value.trim().toLowerCase();
  if (!STATUSES.includes(status)) {
    throw fail(400, "status must be draft, approved, scheduled, or posted.");
  }
  return status;
}

function readWhen(value) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw fail(400, "scheduledAt must be a date and time.");
  return date;
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
    throw Object.assign(new Error("Could not prepare the LinkedIn draft table."), {
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
  if (typeof id !== "string" || !id.trim()) throw fail(400, "Draft id is required.");
  let row;
  try {
    row = await db().linkedInDraft.findUnique({ where: { id: id.trim() } });
  } catch (err) {
    throw storeDown(err);
  }
  if (!row || row.userId !== userId) throw fail(404, "No draft with that id.");
  return row;
}

async function createDraft({ userId, body, notes, kind }) {
  const owner = requireUserId(userId);
  const data = {
    userId: owner,
    body: readBody(body),
    notes: readNotes(notes),
    kind: readKind(kind),
    status: "draft",
    scheduledAt: null,
  };
  await ensureTable();
  try {
    return await db().linkedInDraft.create({ data });
  } catch (err) {
    throw storeDown(err);
  }
}

async function listDrafts({ userId, kind, status } = {}) {
  const owner = requireUserId(userId);
  const where = { userId: owner };
  if (kind) where.kind = readKind(kind, true);
  if (status) where.status = readStatus(status);
  await ensureTable();
  try {
    return await db().linkedInDraft.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });
  } catch (err) {
    throw storeDown(err);
  }
}

// Body, notes, and kind only. Status and scheduledAt stay put.
async function updateDraftContent({ id, userId, body, notes, kind }) {
  const owner = requireUserId(userId);
  await ensureTable();
  const row = await loadOwned(id, owner);
  try {
    return await db().linkedInDraft.update({
      where: { id: row.id },
      data: {
        body: readBody(body),
        notes: readNotes(notes),
        kind: readKind(kind),
      },
    });
  } catch (err) {
    throw storeDown(err);
  }
}

async function patchDraft({ id, userId, patch }) {
  const owner = requireUserId(userId);
  const source = patch && typeof patch === "object" ? patch : {};
  const keys = ["body", "notes", "kind", "status", "scheduledAt"].filter((key) =>
    Object.prototype.hasOwnProperty.call(source, key),
  );
  if (!keys.length) throw fail(400, "Nothing to update.");

  await ensureTable();
  const row = await loadOwned(id, owner);
  const data = {};
  if (Object.prototype.hasOwnProperty.call(source, "body")) data.body = readBody(source.body);
  if (Object.prototype.hasOwnProperty.call(source, "notes")) data.notes = readNotes(source.notes);
  if (Object.prototype.hasOwnProperty.call(source, "kind")) data.kind = readKind(source.kind, true);

  const wantsStatus = Object.prototype.hasOwnProperty.call(source, "status");
  const wantsWhen = Object.prototype.hasOwnProperty.call(source, "scheduledAt");
  let status = row.status;

  if (wantsStatus) {
    const next = readStatus(source.status);
    if (next === "draft" || next === "scheduled") {
      throw fail(400, "Approve a draft, set a time once it is approved, or mark it posted by hand.");
    }
    if (next === "approved") {
      if (row.status !== "draft" && row.status !== "approved") {
        throw fail(400, "Approve is only for a draft.");
      }
      status = "approved";
    } else if (next === "posted") {
      if (wantsWhen && source.scheduledAt) {
        throw fail(400, "A posted draft does not take a schedule.");
      }
      status = "posted";
    }
  }

  if (wantsWhen) {
    const when = readWhen(source.scheduledAt);
    if (status === "posted" || (row.status === "posted" && status === "posted")) {
      throw fail(400, "A posted draft does not take a schedule.");
    }
    if (when == null) {
      data.scheduledAt = null;
      if (row.status === "scheduled" && status !== "posted") status = "approved";
    } else if (status === "draft") {
      throw fail(400, "Approve the draft before scheduling.");
    } else if (status === "approved" || status === "scheduled") {
      data.scheduledAt = when;
      status = "scheduled";
    } else {
      throw fail(400, "Approve the draft before scheduling.");
    }
  }

  if (status !== row.status) data.status = status;
  if (!Object.keys(data).length) return row;
  try {
    return await db().linkedInDraft.update({ where: { id: row.id }, data });
  } catch (err) {
    throw storeDown(err);
  }
}

module.exports = {
  STATUSES,
  TABLE_STATEMENTS,
  ensureTable,
  resetTableCache,
  createDraft,
  listDrafts,
  updateDraftContent,
  patchDraft,
};
