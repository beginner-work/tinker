/* POST /api/browser-search
 *
 * Body: { query, anonymousId?, owner?, platform? }
 * Reply: {
 *   query,
 *   chosen: { title, url, domain, snippet, why },
 *   alternatives: [{ title, url, domain, snippet, why }],
 *   results: [...raw search hits...]
 * }
 *
 * Claude web_search picks ONE best expert-text source (+ alts).
 * Page bodies are never rewritten here — open via /api/reading?action=extract|session.
 */

"use strict";

const { withResponseLogging } = require("./_lib/log.js");
const stytch = require("./_lib/stytch.js");
const reading = require("./_lib/reading-agent.js");
const { readJsonBody } = require("./_lib/user-data.js");
const browserSearch = require("./_lib/browser-search.js");
const resumeMetrics = require("./_lib/metrics/resume.js");
const metricsEmit = require("./_lib/metrics/emit.js");

function createHandler(deps) {
  const authenticateSession =
    (deps && deps.authenticateSession) || stytch.authenticateSession;
  const runWebSearch = (deps && deps.runWebSearch) || browserSearch.runWebSearch;
  const readBody = (deps && deps.readJsonBody) || readJsonBody;

  function publicSessionsAllowed() {
    const raw = String(process.env.READING_PUBLIC_SESSIONS || "1").trim().toLowerCase();
    return raw !== "0" && raw !== "false" && raw !== "off";
  }

  async function resolveAuth(req) {
    const expected = reading.serviceToken();
    const headers = req.headers || {};
    const bearer = reading.extractBearer(
      headers.authorization || headers.Authorization,
    );
    const headerToken = String(
      headers["x-tinker-service-token"] || headers["X-Tinker-Service-Token"] || "",
    ).trim();

    if (expected) {
      if (bearer && reading.timingSafeEqual(bearer, expected)) {
        return { caller: "service:browser-search", via: "service-token" };
      }
      if (headerToken && reading.timingSafeEqual(headerToken, expected)) {
        return { caller: "service:browser-search", via: "service-token" };
      }
    }
    if (bearer) {
      try {
        const session = await authenticateSession(bearer);
        const userId =
          (session && session.session && session.session.user_id) ||
          (session && session.user && session.user.user_id) ||
          "";
        if (userId) return { caller: `user:${userId}`, via: "session" };
      } catch {
        /* fall through */
      }
    }
    if (publicSessionsAllowed()) {
      return { caller: "learn:public", via: "public-session" };
    }
    if (!expected) {
      const err = new Error("TINKER_SERVICE_TOKEN is not configured on this deploy.");
      err.status = 503;
      throw err;
    }
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }

  return async function handler(req, res) {
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }
    try {
      await resolveAuth(req);
      const body = await readBody(req);
      const query = String((body && body.query) || "").trim();
      if (!query) {
        res.status(400).json({ error: "query is required" });
        return;
      }
      const started = Date.now();
      const result = await runWebSearch(query);
      res.status(200).json({
        ...result,
        platform: reading.normalizePlatform(body && body.platform) || "",
        anonymousId: resumeMetrics.normalizeAnonymousId(
          body && (body.anonymousId || body.aid),
        ),
        isOwner: metricsEmit.isOwnerTraffic(
          body && (body.owner === true || body.owner === "1" || body.isOwner)
            ? true
            : body && body.owner,
        ),
        latencyMs: Date.now() - started,
      });
    } catch (err) {
      const status = (err && err.status) || 500;
      res.status(status).json({
        error: (err && err.message) || "Search failed",
      });
    }
  };
}

module.exports = withResponseLogging(createHandler());
module.exports.createHandler = createHandler;
