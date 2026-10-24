/* GET /api/site/visitors
 *
 * Public, cookieless totals for the lindowlabs.dev Visitors page.
 * Cached ~5 minutes. CORS only for lindowlabs.dev origins.
 */

"use strict";

const { withResponseLogging } = require("../_lib/log.js");
const site = require("../_lib/site-analytics.js");

const PUBLIC_CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method === "OPTIONS") {
    site.corsPreflight(req, res, "GET, OPTIONS");
    return;
  }

  site.applyCors(req, res);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    res.setHeader("Cache-Control", "no-store");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  res.setHeader("Cache-Control", PUBLIC_CACHE);

  try {
    const payload = await site.visitorsSummary();
    res.status(200).json(payload);
  } catch (err) {
    if (site.isMissingSiteSchema(err)) {
      res.status(200).json(site.emptyVisitorsPayload());
      return;
    }
    res.status(200).json(site.emptyVisitorsPayload());
  }
});
