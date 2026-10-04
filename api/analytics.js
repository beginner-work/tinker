/* /api/analytics
 *
 * POST  body { events?, keystrokes?, ownerEdits? }
 *       → ingest. ownerEdits accepted only for METRICS_OWNER_ALLOWLIST.
 *       Keystrokes + events never go to Vercel Web Analytics.
 * GET   ?action=capabilities     → { ownerReplay: bool } for signed-in user
 * GET   ?action=summary&days=    → owner-only product funnel aggregates
 * GET   ?action=events&name=     → owner-only raw recent rows
 * GET   ?action=session&sessionId= → owner-only keystroke timeline (no text)
 * GET   ?action=how_i_write      → owner-only learning overview
 * GET   ?action=how_i_write_session&sessionId= → owner-only session breakdown
 */

"use strict";

const { authenticateSession } = require("./_lib/stytch.js");
const { withResponseLogging } = require("./_lib/log.js");
const analytics = require("./_lib/analytics.js");

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function actionOf(req) {
  const url = new URL(req.url || "/", "https://tinker.local");
  return (url.searchParams.get("action") || "").trim().toLowerCase();
}

function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > 512 * 1024) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error("Invalid JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

async function optionalUserId(req) {
  const token = extractBearer(req.headers && req.headers.authorization);
  if (!token) return "";
  try {
    const session = await authenticateSession(token);
    return (
      (session && session.session && session.session.user_id) ||
      (session && session.user && session.user.user_id) ||
      ""
    );
  } catch {
    return "";
  }
}

async function requireUser(req) {
  const token = extractBearer(req.headers && req.headers.authorization);
  if (!token) {
    throw Object.assign(new Error("Sign in required."), { status: 401 });
  }
  const session = await authenticateSession(token);
  const userId =
    (session && session.session && session.session.user_id) ||
    (session && session.user && session.user.user_id) ||
    "";
  if (!userId) {
    throw Object.assign(new Error("Session missing user id"), { status: 401 });
  }
  return userId;
}

async function requireOwner(req) {
  const userId = await requireUser(req);
  if (!analytics.isMetricsOwner(userId)) {
    throw Object.assign(new Error("Not available for this account."), { status: 403 });
  }
  return userId;
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method === "POST") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      res.status(err.status || 400).json({ error: err.message || "Bad request" });
      return;
    }
    const userId = await optionalUserId(req);
    let eventsAccepted = 0;
    let keystrokesAccepted = 0;
    let ownerEditsAccepted = 0;
    let surfaceAccepted = 0;
    try {
      if (body && Array.isArray(body.events) && body.events.length) {
        const result = await analytics.ingestBatch(body.events, userId);
        eventsAccepted = result.accepted;
      }
      if (body && Array.isArray(body.keystrokes) && body.keystrokes.length) {
        const result = await analytics.ingestKeystrokeChunks(body.keystrokes, userId);
        keystrokesAccepted = result.accepted;
      }
      if (body && Array.isArray(body.ownerEdits) && body.ownerEdits.length) {
        const result = await analytics.ingestOwnerEdits(body.ownerEdits, userId);
        ownerEditsAccepted = result.accepted;
      }
      if (body && Array.isArray(body.surfaceEvents) && body.surfaceEvents.length) {
        const result = await analytics.ingestSurfaceEvents(body.surfaceEvents, userId);
        surfaceAccepted = result.accepted;
      }
      res.status(202).json({
        ok: true,
        accepted: eventsAccepted,
        keystrokesAccepted,
        ownerEditsAccepted,
        surfaceAccepted,
      });
    } catch {
      res.status(202).json({
        ok: false,
        accepted: 0,
        keystrokesAccepted: 0,
        ownerEditsAccepted: 0,
        surfaceAccepted: 0,
      });
    }
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    const url = new URL(req.url || "/", "https://tinker.local");
    const action = actionOf(req) || "summary";

    // capabilities: any signed-in user can ask; tells the client whether
    // owner edit-log recording is on (never enables text for others).
    if (action === "capabilities") {
      try {
        const userId = await requireUser(req);
        res.status(200).json({
          ownerEditLog: analytics.isMetricsOwner(userId),
        });
      } catch (err) {
        if (err.status === 401) {
          res.status(200).json({ ownerEditLog: false });
          return;
        }
        res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
      }
      return;
    }

    let ownerId;
    try {
      ownerId = await requireOwner(req);
    } catch (err) {
      res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
      return;
    }
    try {
      if (action === "summary") {
        try { await analytics.rollupExpiredKeystrokes(); } catch { /* ignore */ }
      }
      if (action === "events") {
        const rows = await analytics.recentEvents({
          name: url.searchParams.get("name") || "",
          limit: url.searchParams.get("limit") || 50,
        });
        res.status(200).json({ events: rows });
        return;
      }
      if (action === "session") {
        const timeline = await analytics.sessionTimeline(url.searchParams.get("sessionId") || "");
        if (!timeline) {
          res.status(404).json({ error: "Session not found" });
          return;
        }
        res.status(200).json(timeline);
        return;
      }
      if (action === "how_i_write") {
        const overview = await analytics.howIWriteOverview(ownerId);
        res.status(200).json(overview);
        return;
      }
      if (action === "how_i_write_session") {
        const detail = await analytics.howIWriteSession(
          ownerId,
          url.searchParams.get("sessionId") || ""
        );
        if (!detail) {
          res.status(404).json({ error: "Session not found" });
          return;
        }
        res.status(200).json(detail);
        return;
      }
      const days = Number(url.searchParams.get("days") || 7);
      const summary = await analytics.metricsSummary(days === 30 ? 30 : 7);
      res.status(200).json(summary);
    } catch (err) {
      if (analytics.isMissingAnalyticsSchema(err)) {
        res.status(503).json({
          error: "metrics not set up yet",
          code: "metrics_not_setup",
        });
        return;
      }
      res.status(err.status || 503).json({ error: err.message || "Unavailable" });
    }
    return;
  }

  res.setHeader("Allow", "GET, HEAD, POST");
  res.status(405).json({ error: "Method not allowed" });
});
