/* Claude web_search for Tinker Learn (iOS).
 *
 * Picks ONE best expert-text source for the user's learning goal, with a
 * short why, plus alternate results the user can switch to. Anthropic key
 * stays server-side. Never returns rewritten page bodies — reading text
 * is always fetched verbatim via fetch-page / extract.
 *
 * Author rule: never invent. Prefer a search hit that has extractable
 * author metadata (JSON-LD → meta author → article:author → byline →
 * org/site). Probe chosen + alternatives; swap to an authored alt when
 * the pick has none.
 */

"use strict";

const { callAnthropic } = require("./anthropic.js");
const { fetchPage } = require("./fetch-page.js");
const models = require("../../src/renderer/lib/claude-models.js");

const SEARCH_SYSTEM = `You help Tinker choose ONE webpage of expert text for someone who wants to learn.
Always use the web_search tool.
Prefer official docs, READMEs, API references, engineering guides, talk transcripts, and similar expert writing.
Prefer pages that clearly name a human or organization author in the result snippet or title when possible — but NEVER invent an author name.
After searching, reply with ONLY a JSON object (no markdown fences):
{
  "chosenUrl": "https://...",
  "why": "one short sentence on why this page fits the learning goal",
  "alternatives": [
    { "url": "https://...", "why": "short reason" }
  ]
}
Rules:
- chosenUrl and every alternatives[].url MUST come from the web_search results. Never invent URLs.
- Include 2–4 alternatives when available (distinct from chosenUrl).
- Do not rewrite, summarize, or quote long page bodies.
- Do not invent or guess author names.
- why must be one plain sentence, under 160 characters.`;

function domainOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function collectSearchResults(content) {
  const out = [];
  const seen = new Set();

  function push(item) {
    if (!item || typeof item !== "object") return;
    const url = String(item.url || "").trim();
    if (!/^https?:\/\//i.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    out.push({
      title: String(item.title || url).trim().slice(0, 300),
      url,
      domain: domainOf(url),
      snippet: String(item.encrypted_content || item.snippet || item.page_age || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 280),
    });
  }

  for (const block of Array.isArray(content) ? content : []) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const item of block.content) {
        if (item && item.type === "web_search_result") push(item);
      }
    }
    if (block.type === "web_search_result") push(block);
    if (Array.isArray(block.citations)) {
      for (const c of block.citations) {
        if (c && (c.type === "web_search_result_location" || c.url)) {
          push({ url: c.url, title: c.title, snippet: c.cited_text || "" });
        }
      }
    }
  }
  return out;
}

function parsePickJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function enrichFromCatalog(url, catalog, why) {
  const hit = catalog.find((r) => r.url === url) || null;
  return {
    title: (hit && hit.title) || url,
    url,
    domain: domainOf(url) || (hit && hit.domain) || "",
    snippet: (hit && hit.snippet) || "",
    why: String(why || "").trim().slice(0, 200),
  };
}

/**
 * Probe candidate URLs for extractable author metadata. Never invents.
 * Returns the first page with a non-empty author; otherwise the first
 * successful fetch (authorUnknown). Caps probes to keep latency bounded.
 *
 * @param {string[]} urls
 * @param {{ fetchPageFn?: Function, maxProbes?: number }} [opts]
 */
async function preferAuthoredSource(urls, opts = {}) {
  const doFetch = opts.fetchPageFn || fetchPage;
  const maxProbes = Math.max(1, Math.min(6, Number(opts.maxProbes) || 5));
  const unique = [];
  const seen = new Set();
  for (const u of urls) {
    const url = String(u || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    unique.push(url);
    if (unique.length >= maxProbes) break;
  }

  let fallback = null;
  for (const url of unique) {
    try {
      const page = await doFetch(url);
      const author = String((page && page.author) || "").trim();
      const authorUnknown = Boolean(
        page && (page.authorUnknown || !author),
      );
      const hit = {
        url: (page && page.sourceUrl) || url,
        title: (page && page.title) || "",
        author,
        authorSource: (page && page.authorSource) || (author ? "fetch" : "none"),
        authorUnknown,
        siteName: (page && page.siteName) || "",
        text: (page && page.text) || "",
        wordCount: (page && page.wordCount) || 0,
        attribution: (page && page.attribution) || "",
        page,
      };
      if (!authorUnknown && author) return hit;
      if (!fallback) fallback = hit;
    } catch {
      /* try next candidate */
    }
  }
  return fallback;
}

/**
 * @param {string} query
 * @param {{ callAnthropicFn?: Function, model?: string, fetchPageFn?: Function, preferAuthored?: boolean }} [opts]
 */
async function runWebSearch(query, opts = {}) {
  const q = String(query || "").trim().slice(0, 500);
  if (!q) {
    throw Object.assign(new Error("query is required"), { status: 400 });
  }
  const doCall = opts.callAnthropicFn || callAnthropic;
  const model =
    opts.model ||
    process.env.BROWSER_SEARCH_MODEL ||
    models.FAST ||
    "claude-haiku-4-5-20251001";

  const reply = await doCall({
    system: SEARCH_SYSTEM,
    model,
    maxTokens: 1200,
    messages: [
      {
        role: "user",
        content:
          `Learning goal: ${q}\n\n` +
          `Search, then pick the single best expert-text page to read aloud. JSON only.`,
      },
    ],
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 3,
      },
    ],
  });

  const catalog = collectSearchResults(reply.content || []);
  const byUrl = new Map(catalog.map((r) => [r.url, r]));
  const pick = parsePickJson(reply.text);

  let chosenUrl = "";
  let why = "";
  const altRaw = [];

  if (pick && typeof pick === "object") {
    chosenUrl = String(pick.chosenUrl || "").trim();
    why = String(pick.why || "").trim();
    if (Array.isArray(pick.alternatives)) {
      for (const a of pick.alternatives) {
        if (!a) continue;
        if (typeof a === "string") altRaw.push({ url: a, why: "" });
        else altRaw.push({ url: String(a.url || "").trim(), why: String(a.why || "") });
      }
    }
  }

  // Only keep URLs that actually appeared in search results.
  if (chosenUrl && !byUrl.has(chosenUrl)) {
    const chosenHost = domainOf(chosenUrl);
    const match = catalog.find((r) => r.url === chosenUrl || domainOf(r.url) === chosenHost);
    chosenUrl = match ? match.url : "";
  }
  if (!chosenUrl && catalog.length) {
    chosenUrl = catalog[0].url;
    why = why || "Top search result for this learning goal.";
  }
  if (!chosenUrl) {
    throw Object.assign(
      new Error("No searchable expert-text sources found for that goal."),
      { status: 404 },
    );
  }

  const alternatives = [];
  const seen = new Set([chosenUrl]);
  for (const a of altRaw) {
    let u = a.url;
    if (!u || seen.has(u)) continue;
    if (!byUrl.has(u)) {
      const host = domainOf(u);
      const match = catalog.find((r) => r.url === u || domainOf(r.url) === host);
      if (!match) continue;
      u = match.url;
    }
    if (seen.has(u)) continue;
    seen.add(u);
    alternatives.push(enrichFromCatalog(u, catalog, a.why));
    if (alternatives.length >= 4) break;
  }
  for (const r of catalog) {
    if (alternatives.length >= 4) break;
    if (seen.has(r.url)) continue;
    seen.add(r.url);
    alternatives.push(enrichFromCatalog(r.url, catalog, "Also relevant."));
  }

  let chosen = enrichFromCatalog(chosenUrl, catalog, why || "Best match for this learning goal.");
  let authorMeta = null;
  const shouldPrefer = opts.preferAuthored !== false;

  if (shouldPrefer) {
    const probeOrder = [chosenUrl, ...alternatives.map((a) => a.url)];
    authorMeta = await preferAuthoredSource(probeOrder, {
      fetchPageFn: opts.fetchPageFn,
    });
    if (authorMeta && authorMeta.url && authorMeta.url !== chosenUrl) {
      const swappedWhy = authorMeta.author
        ? `Preferred a source with attributed author (${authorMeta.author}).`
        : chosen.why;
      // Move former chosen into alternatives if missing.
      if (!alternatives.some((a) => a.url === chosenUrl)) {
        alternatives.unshift({
          ...chosen,
          why: chosen.why || "Model pick (no extractable author).",
        });
        if (alternatives.length > 4) alternatives.length = 4;
      }
      chosen = {
        ...enrichFromCatalog(authorMeta.url, catalog, swappedWhy),
        title: authorMeta.title || enrichFromCatalog(authorMeta.url, catalog, "").title,
      };
      // Drop the new chosen from alternatives.
      const idx = alternatives.findIndex((a) => a.url === chosen.url);
      if (idx >= 0) alternatives.splice(idx, 1);
    }
  }

  if (authorMeta) {
    chosen = {
      ...chosen,
      author: authorMeta.author || "",
      authorSource: authorMeta.authorSource || "none",
      authorUnknown: Boolean(authorMeta.authorUnknown),
      siteName: authorMeta.siteName || "",
    };
  } else {
    chosen = {
      ...chosen,
      author: "",
      authorSource: "none",
      authorUnknown: true,
      siteName: "",
    };
  }

  return {
    query: q,
    chosen,
    alternatives,
    results: catalog,
    resultCount: catalog.length,
    model,
    usage: reply.usage || null,
  };
}

module.exports = {
  SEARCH_SYSTEM,
  domainOf,
  collectSearchResults,
  parsePickJson,
  enrichFromCatalog,
  preferAuthoredSource,
  runWebSearch,
};
