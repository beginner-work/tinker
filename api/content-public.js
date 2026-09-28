/* GET /api/sites/:site/content
 * GET /api/content-public?site=
 *
 * Public read of one site's published content. No session. Drafts are
 * omitted. A slug that is missing or still a draft is 404, so a draft
 * is not distinguishable from a missing item. Responses are cacheable.
 * The owner id, note id, and draft key are not included.
 */

"use strict";

const { withResponseLogging } = require("./_lib/log.js");
const store = require("./_lib/content-store.js");

const PUBLIC_CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";
const MISS_CACHE = "public, max-age=15";

function queryValue(req, key) {
  const fromQuery = req.query && req.query[key];
  const value = Array.isArray(fromQuery) ? fromQuery[0] : fromQuery;
  if (value != null && value !== "") return String(value);
  try {
    return new URL(req.url || "/", "http://localhost").searchParams.get(key) || "";
  } catch {
    return "";
  }
}

function sendJson(res, status, body, cache) {
  res.setHeader("Cache-Control", cache);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(status).json(body);
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Cache-Control", PUBLIC_CACHE);
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.setHeader("Cache-Control", "no-store");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const site = queryValue(req, "site");
  const slug = queryValue(req, "slug");
  const type = queryValue(req, "type");
  try {
    if (slug) {
      const rows = await store.listPublished({ site, slug, type });
      if (!rows.length) {
        sendJson(res, 404, { error: "No published content with that slug." }, MISS_CACHE);
        return;
      }
      sendJson(res, 200, { item: store.presentPublic(rows[0]) }, PUBLIC_CACHE);
      return;
    }
    const rows = await store.listPublished({ site, type });
    sendJson(res, 200, {
      site: rows.length ? rows[0].site : store.normalizeSite(site),
      items: rows.map(store.presentPublic),
    }, PUBLIC_CACHE);
  } catch (err) {
    const status = err.status || 500;
    const message = status >= 500 ? store.UNAVAILABLE : err.message || "Bad request";
    const cache = status === 404 ? MISS_CACHE : "no-store";
    sendJson(res, status, { error: message }, cache);
  }
});
