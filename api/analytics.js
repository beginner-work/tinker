/* /api/analytics
 *
 * POST  body { events?: [...], keystrokes?: [...] }
 *       → ingest (optional Bearer links user id). Keystrokes never go to
 *       Vercel Web Analytics — first-party DB only.
 * GET   ?action=summary&days=7|30  → owner-only aggregates
 * GET   ?action=events&name=&limit= → owner-only raw recent rows
 * GET   ?action=session&sessionId= → owner-only writing timeline
 *
 * Anonymous ingest is intentional: pre-signin funnels need it.
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
      if (total > 256 * 1024) {
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

async function requireOwner(req) {
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
    try {
      if (body && Array.isArray(body.events) && body.events.length) {
        const result = await analytics.ingestBatch(body.events, userId);
        eventsAccepted = result.accepted;
      }
      if (body && Array.isArray(body.keystrokes) && body.keystrokes.length) {
        const result = await analytics.ingestKeystrokeChunks(body.keystrokes, userId);
        keystrokesAccepted = result.accepted;
      }
      res.status(202).json({
        ok: true,
        accepted: eventsAccepted,
        keystrokesAccepted,
      });
    } catch {
      res.status(202).json({ ok: false, accepted: 0, keystrokesAccepted: 0 });
    }
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    try {
      await requireOwner(req);
    } catch (err) {
      res.status(err.status || 401).json({ error: err.message || "Unauthorized" });
      return;
    }
    const url = new URL(req.url || "/", "https://tinker.local");
    const action = actionOf(req) || "summary";
    try {
      // Opportunistic 90-day rollup while the owner is looking.
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
      const days = Number(url.searchParams.get("days") || 7);
      const summary = await analytics.metricsSummary(days === 30 ? 30 : 7);
      res.status(200).json(summary);
    } catch (err) {
      res.status(err.status || 503).json({ error: err.message || "Unavailable" });
    }
    return;
  }

  res.setHeader("Allow", "GET, HEAD, POST");
  res.status(405).json({ error: "Method not allowed" });
});
