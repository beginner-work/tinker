/* POST /api/site/ping
 *
 * Cookieless page-view ping from lindowlabs.dev. Accepts JSON or
 * text/plain (navigator.sendBeacon). Never stores IP, UA, cookies, or
 * full referrer URLs. Returns 204 always on success / soft-drop paths
 * (bots, rate limit, missing table, bad body).
 */

"use strict";

const { withResponseLogging } = require("../_lib/log.js");
const site = require("../_lib/site-analytics.js");

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method === "OPTIONS") {
    site.corsPreflight(req, res, "POST, OPTIONS");
    return;
  }

  site.applyCors(req, res);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    res.status(405).end();
    return;
  }

  // Soft-drop bots without storing the UA.
  const ua = (req.headers && (req.headers["user-agent"] || req.headers["User-Agent"])) || "";
  if (site.isObviousBot(ua)) {
    res.status(204).end();
    return;
  }

  if (site.rateLimitExceeded(req)) {
    res.status(204).end();
    return;
  }

  let bodyResult;
  try {
    bodyResult = await site.readRequestBody(req);
  } catch {
    res.status(204).end();
    return;
  }

  if (!bodyResult || !bodyResult.ok) {
    res.status(204).end();
    return;
  }

  const event = site.sanitizePingBody(bodyResult.value);
  if (!event) {
    res.status(204).end();
    return;
  }

  try {
    await site.recordPing(event);
  } catch (err) {
    if (site.isMissingSiteSchema(err)) {
      res.status(204).end();
      return;
    }
    // Soft-drop unexpected DB errors so the public site never 500s.
    res.status(204).end();
    return;
  }

  res.status(204).end();
});
