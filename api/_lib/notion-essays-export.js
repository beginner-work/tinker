/* One-time export: Founder Source essays → Notion Essays database.
 *
 * Copies title, date, and full body. Skips rows already present
 * (match by Tinker essay id stored in Exercise, or by title).
 * Creates the Essays database under the saved parent page when missing.
 */

"use strict";

const essaysMcp = require("./essays-mcp.js");
const notionApi = require("./notion-api.js");
const tokenStore = require("./notion-token-store.js");

const NOTION_VERSION = notionApi.NOTION_VERSION;
const API_BASE = "https://api.notion.com/v1";
const EXPORT_EXERCISE_PREFIX = "tinker:";
const WRITE_GAP_MS = 350;

function fail(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function normalizeTitle(value) {
  return String(value == null ? "" : value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function richTextPlain(prop) {
  if (!prop || !Array.isArray(prop.rich_text)) return "";
  return prop.rich_text
    .map((t) => (t && t.plain_text != null ? String(t.plain_text) : ""))
    .join("")
    .trim();
}

function titlePlain(prop) {
  if (!prop || !Array.isArray(prop.title)) return "";
  return prop.title
    .map((t) => (t && t.plain_text != null ? String(t.plain_text) : ""))
    .join("")
    .trim();
}

function exerciseTagFor(essayId) {
  return EXPORT_EXERCISE_PREFIX + String(essayId || "").trim();
}

function parseExerciseTag(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (s.startsWith(EXPORT_EXERCISE_PREFIX)) {
    return s.slice(EXPORT_EXERCISE_PREFIX.length).trim();
  }
  // Exact essay id also counts (manual / future writers).
  if (/^e_[a-z0-9]+$/i.test(s)) return s;
  return "";
}

async function notionFetch({ accessToken, path, method, body, fetchImpl }) {
  const fetchFn = fetchImpl || fetch;
  const res = await fetchFn(API_BASE + path, {
    method: method || "GET",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Notion-Version": NOTION_VERSION,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (payload && (payload.message || payload.code)) ||
      `Notion API error (${res.status}).`;
    const status =
      res.status === 401 || res.status === 403
        ? 502
        : res.status >= 400 && res.status < 500
          ? 400
          : 502;
    throw fail(status, String(msg), "notion_api_error");
  }
  return payload;
}

async function listEssaysDatabasePages({ accessToken, databaseId, fetchImpl }) {
  const pages = [];
  let cursor;
  do {
    const payload = await notionFetch({
      accessToken,
      path: "/databases/" + databaseId + "/query",
      method: "POST",
      body: {
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      },
      fetchImpl,
    });
    const results = payload && Array.isArray(payload.results) ? payload.results : [];
    for (const row of results) {
      if (!row || row.object !== "page") continue;
      const props = row.properties || {};
      const title = titlePlain(props.Name);
      const exercise = richTextPlain(props.Exercise);
      pages.push({
        id: String(row.id),
        title,
        exercise,
        essayId: parseExerciseTag(exercise),
        url: row.url || null,
      });
    }
    cursor = payload && payload.has_more ? payload.next_cursor : null;
  } while (cursor);
  return pages;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Export every Founder Source essay into the owner's Notion Essays DB.
 *
 * @returns {{
 *   found: number,
 *   written: number,
 *   skipped: number,
 *   failed: number,
 *   dryRun: boolean,
 *   databaseId: string,
 *   errors: Array<{ id: string, title: string, error: string }>,
 *   writtenPages: Array<{ id: string, title: string, notionPageId?: string, url?: string }>
 * }}
 */
async function exportFounderSourceEssays({
  userId,
  dryRun = false,
  fetchImpl,
  writeGapMs = WRITE_GAP_MS,
} = {}) {
  const uid = typeof userId === "string" ? userId.trim() : "";
  if (!uid) throw fail(401, "Sign in to tinker first.");

  const settings = await tokenStore.getSettings({ userId: uid });
  if (!settings.parentPageId) {
    throw fail(
      400,
      "Pick a Notion parent page in Connections before exporting essays.",
      "notion_parent_required",
    );
  }

  const essays = await essaysMcp.listFounderSourceEssaysFull({ userId: uid });
  const { accessToken, databaseId } = await notionApi.ensureEssaysDatabase({
    userId: uid,
    fetchImpl,
  });

  const existing = await listEssaysDatabasePages({
    accessToken,
    databaseId,
    fetchImpl,
  });
  const byEssayId = new Set(
    existing.map((p) => p.essayId).filter(Boolean),
  );
  const byTitle = new Set(
    existing.map((p) => normalizeTitle(p.title)).filter(Boolean),
  );

  const out = {
    found: essays.length,
    written: 0,
    skipped: 0,
    failed: 0,
    dryRun: !!dryRun,
    databaseId,
    errors: [],
    writtenPages: [],
  };

  for (let i = 0; i < essays.length; i += 1) {
    const essay = essays[i];
    const essayId = String(essay.id || "").trim();
    const title = String(essay.title || essay.storedTitle || "").trim() || "Untitled";
    const body = String(essay.body || "");
    const titleKey = normalizeTitle(title);

    if (
      (essayId && byEssayId.has(essayId)) ||
      (titleKey && byTitle.has(titleKey))
    ) {
      out.skipped += 1;
      continue;
    }

    if (dryRun) {
      out.written += 1;
      out.writtenPages.push({ id: essayId, title });
      if (essayId) byEssayId.add(essayId);
      if (titleKey) byTitle.add(titleKey);
      continue;
    }

    try {
      const page = await notionApi.writeEssay({
        userId: uid,
        title,
        body,
        date: essay.updatedAt || essay.createdAt,
        learningGoal: "",
        exercise: exerciseTagFor(essayId),
        fetchImpl,
      });
      out.written += 1;
      out.writtenPages.push({
        id: essayId,
        title,
        notionPageId: page.id,
        url: page.url || null,
      });
      if (essayId) byEssayId.add(essayId);
      if (titleKey) byTitle.add(titleKey);
      if (writeGapMs > 0 && i < essays.length - 1) {
        await sleep(writeGapMs);
      }
    } catch (err) {
      out.failed += 1;
      out.errors.push({
        id: essayId,
        title,
        error: (err && err.message) || String(err),
      });
    }
  }

  return out;
}

module.exports = {
  EXPORT_EXERCISE_PREFIX,
  WRITE_GAP_MS,
  normalizeTitle,
  exerciseTagFor,
  parseExerciseTag,
  listEssaysDatabasePages,
  exportFounderSourceEssays,
};
