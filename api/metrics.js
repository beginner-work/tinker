/* /api/metrics
 *
 * Resume metrics (reading agent + SDK embeds). Definitions and contract:
 * RESUME_METRICS.md at the repo root.
 *
 * GET  (default)           → collectResumeMetrics payload
 * POST ?action=record_eval → persist a Braintrust / eval gate result
 * POST ?action=sdk_loaded  → record an embed host (optional beacon)
 *
 * Auth: TINKER_SERVICE_TOKEN (Bearer or X-Tinker-Service-Token), or a
 * Stytch session whose user id is on METRICS_OWNER_ALLOWLIST /
 * LEADS_OWNER_ALLOWLIST.
 *
 * Owner traffic is excluded from every returned number (see
 * RESUME_METRICS.md rule 3). Env vars for this route belong in Vercel
 * Production only, never Preview.
 */

"use strict";

const crypto = require("node:crypto");
const { withResponseLogging } = require("./_lib/log.js");
const defaultPrisma = require("./_lib/db.js");
const stytch = require("./_lib/stytch.js");
const analytics = require("./_lib/analytics.js");
const resumeMetrics = require("./_lib/metrics/resume.js");
const metricsEmit = require("./_lib/metrics/emit.js");
const { readJsonBody } = require("./_lib/user-data.js");

function actionOf(req) {
  try {
    return new URL(req.url || "/", "https://tinker.local")
      .searchParams.get("action") || "";
  } catch {
    return "";
  }
}

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function serviceToken() {
  return String(process.env.TINKER_SERVICE_TOKEN || "").trim();
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function createHandler(deps) {
  const prisma = (deps && deps.prisma) || defaultPrisma;
  const authenticateSession =
    (deps && deps.authenticateSession) || stytch.authenticateSession;
  const collect =
    (deps && deps.collectResumeMetrics) || resumeMetrics.collectResumeMetrics;
  const recordEval =
    (deps && deps.recordEvalRun) || resumeMetrics.recordEvalRun;
  const recordHost =
    (deps && deps.recordEmbedHost) || resumeMetrics.recordEmbedHost;
  const emitSdk =
    (deps && deps.emitSdkLoaded) || metricsEmit.emitSdkLoaded;
  const isOwnerUser =
    (deps && deps.isOwnerUser) || analytics.isMetricsOwner;
  const readBody = (deps && deps.readJsonBody) || readJsonBody;

  async function requireAuth(req) {
    const headers = req.headers || {};
    const expected = serviceToken();
    const bearer = extractBearer(headers.authorization || headers.Authorization);
    const headerToken = String(
      headers["x-tinker-service-token"] || headers["X-Tinker-Service-Token"] || "",
    ).trim();

    if (expected) {
      if (bearer && timingSafeEqual(bearer, expected)) {
        return { via: "service-token" };
      }
      if (headerToken && timingSafeEqual(headerToken, expected)) {
        return { via: "service-token" };
      }
    }

    if (bearer) {
      try {
        const session = await authenticateSession(bearer);
        const userId =
          (session && session.session && session.session.user_id) ||
          (session && session.user && session.user.user_id) ||
          "";
        if (userId && isOwnerUser(userId)) {
          return { via: "owner-session", userId };
        }
      } catch {
        // Fall through.
      }
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

  async function handleGet(_req, res) {
    const payload = await collect(prisma);
    res.status(200).json(payload);
  }

  async function handleRecordEval(req, res) {
    const body = await readBody(req);
    const row = await recordEval(prisma, {
      id: body.id,
      project: body.project || "tinker-ask",
      passRate: body.passRate,
      caseCount: body.caseCount,
      passedCount: body.passedCount,
      failedCount: body.failedCount,
      experimentUrl: body.experimentUrl || "",
      report: body.report || body,
    });
    if (!row) {
      res.status(503).json({ error: "Failed to persist eval run" });
      return;
    }
    res.status(200).json({
      ok: true,
      id: row.id,
      passRate: row.passRate,
      caseCount: row.caseCount,
      createdAt: row.createdAt,
    });
  }

  async function handleSdkLoaded(req, res) {
    const body = await readBody(req);
    const host = resumeMetrics.normalizeHost(body.host || body.embedHost || "");
    const anonymousId = resumeMetrics.normalizeAnonymousId(
      body.anonymousId || body.aid || "",
    );
    const isOwner = metricsEmit.isOwnerTraffic(
      body.owner === true || body.owner === "1" || body.isOwner
        ? true
        : body.owner,
    );
    if (!host) {
      res.status(400).json({ error: "host is required" });
      return;
    }
    const recorded = await recordHost(prisma, host);
    await emitSdk(
      { host, anonymousId: anonymousId || "" },
      { isOwner, headers: req.headers },
    );
    res.status(200).json({
      ok: true,
      host,
      recorded: Boolean(recorded),
      excluded: metricsEmit.isExcludedEmbedHost(host),
    });
  }

  return withResponseLogging(async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");

    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Tinker-Service-Token, X-Tinker-Caller",
      );
      res.status(204).end();
      return;
    }

    try {
      await requireAuth(req);
      const action = actionOf(req).trim().toLowerCase();

      if (req.method === "GET" || req.method === "HEAD") {
        if (action && action !== "resume") {
          res.status(404).json({ error: "Unknown action" });
          return;
        }
        if (req.method === "HEAD") {
          res.status(200).end();
          return;
        }
        await handleGet(req, res);
        return;
      }

      if (req.method === "POST") {
        if (action === "record_eval") {
          await handleRecordEval(req, res);
          return;
        }
        if (action === "sdk_loaded") {
          await handleSdkLoaded(req, res);
          return;
        }
        res.status(404).json({
          error: 'Unknown action. Use ?action=record_eval|sdk_loaded',
        });
        return;
      }

      res.setHeader("Allow", "GET, HEAD, POST, OPTIONS");
      res.status(405).json({ error: "Method not allowed" });
    } catch (err) {
      const status = (err && err.status) || 500;
      res.status(status).json({ error: (err && err.message) || "Metrics error" });
    }
  });
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.__test__ = { createHandler };
