/* Notion REST helpers: Essays database + write finished essays.
 *
 * Creates an "Essays" database under the user's chosen parent page when
 * missing. Each finished essay becomes one database row (title, date,
 * learning goal, exercise) with the body as page content.
 */

"use strict";

const tokenStore = require("./notion-token-store.js");

const NOTION_VERSION = "2022-06-28";
const API_BASE = "https://api.notion.com/v1";
const ESSAYS_DB_TITLE = "Essays";
const RICH_TEXT_MAX = 1900;
const UNAVAILABLE = "Notion API is unavailable right now.";

function fail(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function normalizePageId(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) throw fail(400, "pageId is required.", "notion_page_id_required");
  const hex = s.replace(/-/g, "");
  const fromUrl = s.match(/([a-f0-9]{32})(?:\?|#|$)/i);
  const idHex = fromUrl ? fromUrl[1] : /^[a-f0-9]{32}$/i.test(hex) ? hex : "";
  if (!idHex) {
    if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s)) {
      return s.toLowerCase();
    }
    throw fail(400, "pageId must be a Notion page id or page URL.", "notion_page_id_invalid");
  }
  const h = idHex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function richTextChunks(text) {
  const raw = String(text == null ? "" : text);
  if (!raw) return [];
  const chunks = [];
  for (let i = 0; i < raw.length; i += RICH_TEXT_MAX) {
    chunks.push(raw.slice(i, i + RICH_TEXT_MAX));
  }
  return chunks;
}

function richTextProp(text) {
  const chunks = richTextChunks(text);
  if (!chunks.length) return [{ type: "text", text: { content: "" } }];
  return chunks.slice(0, 1).map((content) => ({
    type: "text",
    text: { content },
  }));
}

function titleProp(text) {
  const title = String(text == null ? "" : text).trim() || "Untitled";
  return richTextProp(title.slice(0, RICH_TEXT_MAX));
}

function bodyBlocks(body) {
  const raw = String(body == null ? "" : body);
  if (!raw.trim()) return [];
  const paragraphs = raw.split(/\n{2,}/);
  const blocks = [];
  for (const para of paragraphs) {
    const chunks = richTextChunks(para);
    if (!chunks.length) {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [] },
      });
      continue;
    }
    for (const content of chunks) {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content } }] },
      });
    }
  }
  // Notion create-page children cap is 100 blocks.
  return blocks.slice(0, 100);
}

function dateIso(value) {
  if (value == null || value === "") return new Date().toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = Date.parse(s);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
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

function essaysDbProperties() {
  return {
    Name: { title: {} },
    Date: { date: {} },
    "Learning goal": { rich_text: {} },
    Exercise: { rich_text: {} },
  };
}

async function createEssaysDatabase({ accessToken, parentPageId, fetchImpl }) {
  const created = await notionFetch({
    accessToken,
    path: "/databases",
    method: "POST",
    body: {
      parent: { type: "page_id", page_id: parentPageId },
      title: [{ type: "text", text: { content: ESSAYS_DB_TITLE } }],
      properties: essaysDbProperties(),
    },
    fetchImpl,
  });
  if (!created || !created.id) {
    throw fail(502, "Could not create Essays database in Notion.", "notion_db_create_failed");
  }
  return String(created.id);
}

async function findEssaysDatabaseUnderParent({ accessToken, parentPageId, fetchImpl }) {
  // Search by title, then keep a result whose parent is this page.
  const payload = await notionFetch({
    accessToken,
    path: "/search",
    method: "POST",
    body: {
      query: ESSAYS_DB_TITLE,
      filter: { property: "object", value: "database" },
      page_size: 20,
    },
    fetchImpl,
  });
  const results = payload && Array.isArray(payload.results) ? payload.results : [];
  for (const row of results) {
    if (!row || row.object !== "database") continue;
    const parent = row.parent;
    if (
      parent &&
      parent.type === "page_id" &&
      String(parent.page_id).replace(/-/g, "") === parentPageId.replace(/-/g, "")
    ) {
      const title = Array.isArray(row.title)
        ? row.title.map((t) => t && t.plain_text).join("")
        : "";
      if (String(title).trim().toLowerCase() === ESSAYS_DB_TITLE.toLowerCase()) {
        return String(row.id);
      }
    }
  }
  return null;
}

async function ensureEssaysDatabase({ userId, fetchImpl } = {}) {
  const live = await tokenStore.getAccessToken({ userId });
  const settings = await tokenStore.getSettings({ userId });
  if (!settings.parentPageId) {
    throw fail(
      400,
      "Pick a Notion parent page in Connections before writing essays.",
      "notion_parent_required",
    );
  }
  if (settings.essaysDatabaseId) {
    return {
      accessToken: live.accessToken,
      databaseId: settings.essaysDatabaseId,
      parentPageId: settings.parentPageId,
    };
  }
  let databaseId = await findEssaysDatabaseUnderParent({
    accessToken: live.accessToken,
    parentPageId: settings.parentPageId,
    fetchImpl,
  });
  if (!databaseId) {
    databaseId = await createEssaysDatabase({
      accessToken: live.accessToken,
      parentPageId: settings.parentPageId,
      fetchImpl,
    });
  }
  await tokenStore.setEssaysDatabaseId({ userId, essaysDatabaseId: databaseId });
  return {
    accessToken: live.accessToken,
    databaseId,
    parentPageId: settings.parentPageId,
  };
}

async function writeEssay({
  userId,
  title,
  body,
  date,
  learningGoal,
  exercise,
  fetchImpl,
} = {}) {
  try {
    const { accessToken, databaseId } = await ensureEssaysDatabase({ userId, fetchImpl });
    const cleanTitle = String(title == null ? "" : title).trim() || "Untitled";
    const cleanBody = String(body == null ? "" : body);
    if (!cleanBody.trim()) {
      throw fail(400, "body is required.", "notion_essay_body_required");
    }
    const goal = String(learningGoal == null ? "" : learningGoal).trim();
    const ex = String(exercise == null ? "" : exercise).trim();
    const children = bodyBlocks(cleanBody);
    const created = await notionFetch({
      accessToken,
      path: "/pages",
      method: "POST",
      body: {
        parent: { database_id: databaseId },
        properties: {
          Name: { title: titleProp(cleanTitle) },
          Date: { date: { start: dateIso(date) } },
          "Learning goal": { rich_text: richTextProp(goal) },
          Exercise: { rich_text: richTextProp(ex) },
        },
        children,
      },
      fetchImpl,
    });
    return {
      id: created.id,
      url: created.url || null,
      databaseId,
      title: cleanTitle,
    };
  } catch (err) {
    if (err && err.status) throw err;
    throw Object.assign(new Error(UNAVAILABLE), { status: 503, cause: err });
  }
}

module.exports = {
  NOTION_VERSION,
  ESSAYS_DB_TITLE,
  UNAVAILABLE,
  normalizePageId,
  ensureEssaysDatabase,
  writeEssay,
};
