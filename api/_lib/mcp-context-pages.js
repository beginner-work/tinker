/* Server: Notion context pages for business / technical goals.
 *
 * Search + fetch via read-only MCP tools (notion-search / notion-fetch).
 * Persist selections in TinkerUserData kind "mcp_context".
 */

"use strict";

const prisma = require("./db.js");
const connectionStore = require("./mcp-connection-store.js");
const { getConnector } = require("./mcp-connectors-registry.js");
const { callMcpTool, toolResultText } = require("./mcp-client-call.js");

const KIND = "mcp_context";
const CONNECTOR_ID = "notion";
const MAX_PAGES = 6;
const MAX_TITLE = 160;
const MAX_SNIPPET = 4000;
const MAX_QUERY = 200;

function fail(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function clamp(text, max) {
  const s = text == null ? "" : String(text);
  if (s.length <= max) return s;
  return s.slice(0, max);
}

function normalizePage(raw, role) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || raw.pageId || "").trim();
  const title = clamp(raw.title || raw.name || "", MAX_TITLE).trim();
  if (!id && !title) return null;
  return {
    id: id || title,
    title: title || id,
    connectorId: String(raw.connectorId || CONNECTOR_ID).trim() || CONNECTOR_ID,
    snippet: clamp(raw.snippet || raw.text || "", MAX_SNIPPET),
    role: role === "technical" ? "technical" : "business",
    url: raw.url ? String(raw.url).slice(0, 500) : null,
  };
}

function emptyContext() {
  return { business: [], technical: [] };
}

function normalizeContext(raw) {
  const base = emptyContext();
  if (!raw || typeof raw !== "object") return base;
  base.business = (Array.isArray(raw.business) ? raw.business : [])
    .map((p) => normalizePage(p, "business"))
    .filter(Boolean)
    .slice(0, MAX_PAGES);
  base.technical = (Array.isArray(raw.technical) ? raw.technical : [])
    .map((p) => normalizePage(p, "technical"))
    .filter(Boolean)
    .slice(0, MAX_PAGES);
  return base;
}

async function readContext(userId) {
  const row = await prisma.tinkerUserData.findUnique({
    where: { userId_kind: { userId, kind: KIND } },
  });
  return normalizeContext(row && row.data);
}

async function writeContext(userId, data) {
  const next = normalizeContext(data);
  await prisma.tinkerUserData.upsert({
    where: { userId_kind: { userId, kind: KIND } },
    create: { userId, kind: KIND, data: next },
    update: { data: next },
  });
  return next;
}

function joinSnippets(pages) {
  return (Array.isArray(pages) ? pages : [])
    .map((p) => {
      const block = ((p && p.title) || "") + "\n" + ((p && p.snippet) || "");
      return block.trim();
    })
    .filter(Boolean)
    .join("\n\n---\n\n");
}

async function requireNotionToken(userId, fetchImpl) {
  const live = await connectionStore.getValidAccessToken({
    userId,
    connectorId: CONNECTOR_ID,
    fetchImpl,
  });
  if (!live || !live.accessToken) {
    throw fail(400, "Connect Notion in Settings > Connections first.", "notion_not_connected");
  }
  const connector = getConnector(CONNECTOR_ID);
  if (!connector) throw fail(500, "Notion connector missing from registry.");
  return { accessToken: live.accessToken, url: connector.url };
}

/**
 * Parse notion-search tool output into [{id,title,url}].
 * Accepts JSON arrays or loose text with id/title lines.
 */
function parseSearchHits(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.results)
        ? parsed.results
        : Array.isArray(parsed.pages)
          ? parsed.pages
          : null;
    if (list) {
      return list
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          const id = String(row.id || row.page_id || row.pageId || "").trim();
          const title = String(
            row.title ||
              row.name ||
              (row.properties && row.properties.title) ||
              ""
          ).trim();
          if (!id && !title) return null;
          return {
            id: id || title,
            title: title || id,
            url: row.url || row.page_url || null,
          };
        })
        .filter(Boolean)
        .slice(0, 20);
    }
  } catch {
    /* fall through */
  }
  // Loose fallback: lines like "id=… title=…"
  const hits = [];
  const lines = raw.split(/\n+/);
  for (const line of lines) {
    const idMatch = line.match(/\bid[=:]\s*([a-zA-Z0-9-]+)/i);
    const titleMatch = line.match(/\btitle[=:]\s*["']?([^"'\n]+)["']?/i);
    if (idMatch || titleMatch) {
      hits.push({
        id: (idMatch && idMatch[1]) || (titleMatch && titleMatch[1]),
        title: (titleMatch && titleMatch[1].trim()) || (idMatch && idMatch[1]),
        url: null,
      });
    }
  }
  return hits.slice(0, 20);
}

async function searchPages({ userId, query, fetchImpl, callTool } = {}) {
  const uid = String(userId || "").trim();
  if (!uid) throw fail(401, "Sign in required.");
  const q = clamp(query, MAX_QUERY).trim();
  if (!q) throw fail(400, "Search query is required.");
  const notion = await requireNotionToken(uid, fetchImpl);
  const call = typeof callTool === "function" ? callTool : callMcpTool;
  const out = await call({
    url: notion.url,
    accessToken: notion.accessToken,
    toolName: "notion-search",
    arguments: { query: q },
    fetchImpl,
  });
  const text = toolResultText(out.result);
  return { query: q, results: parseSearchHits(text), rawText: text.slice(0, 2000) };
}

async function fetchPageSnippet({ userId, pageId, fetchImpl, callTool } = {}) {
  const uid = String(userId || "").trim();
  const id = String(pageId || "").trim();
  if (!uid) throw fail(401, "Sign in required.");
  if (!id) throw fail(400, "pageId is required.");
  const notion = await requireNotionToken(uid, fetchImpl);
  const call = typeof callTool === "function" ? callTool : callMcpTool;
  const out = await call({
    url: notion.url,
    accessToken: notion.accessToken,
    toolName: "notion-fetch",
    arguments: { id },
    fetchImpl,
  });
  const text = toolResultText(out.result);
  let title = "";
  try {
    const parsed = JSON.parse(text);
    title = String(
      (parsed && (parsed.title || parsed.name || parsed.page_title)) || ""
    ).trim();
  } catch {
    const m = text.match(/^#\s+(.+)$/m);
    if (m) title = m[1].trim();
  }
  return {
    id,
    title: title || id,
    snippet: clamp(text, MAX_SNIPPET),
  };
}

async function selectPage({
  userId,
  role,
  pageId,
  title,
  snippet,
  url,
  fetchImpl,
  callTool,
} = {}) {
  const uid = String(userId || "").trim();
  if (!uid) throw fail(401, "Sign in required.");
  const key = role === "technical" ? "technical" : "business";
  let page = normalizePage(
    {
      id: pageId,
      title,
      snippet,
      url,
      connectorId: CONNECTOR_ID,
    },
    key
  );
  if (!page) throw fail(400, "pageId or title is required.");
  if (!page.snippet && page.id) {
    const fetched = await fetchPageSnippet({
      userId: uid,
      pageId: page.id,
      fetchImpl,
      callTool,
    });
    page = normalizePage(
      {
        id: page.id,
        title: page.title || fetched.title,
        snippet: fetched.snippet,
        url: url || null,
        connectorId: CONNECTOR_ID,
      },
      key
    );
  }
  const current = await readContext(uid);
  const list = current[key].filter((p) => p.id !== page.id);
  list.unshift(page);
  current[key] = list.slice(0, MAX_PAGES);
  return writeContext(uid, current);
}

async function clearRole({ userId, role } = {}) {
  const uid = String(userId || "").trim();
  if (!uid) throw fail(401, "Sign in required.");
  const current = await readContext(uid);
  if (role === "technical") current.technical = [];
  else current.business = [];
  return writeContext(uid, current);
}

async function contextForPrompts(userId) {
  const ctx = await readContext(userId);
  return {
    businessContext: joinSnippets(ctx.business),
    technicalGoalsContext: joinSnippets(ctx.technical),
    context: ctx,
  };
}

module.exports = {
  KIND,
  CONNECTOR_ID,
  emptyContext,
  normalizeContext,
  normalizePage,
  readContext,
  writeContext,
  joinSnippets,
  searchPages,
  fetchPageSnippet,
  selectPage,
  clearRole,
  contextForPrompts,
  parseSearchHits,
};
