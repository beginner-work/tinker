/* GET /api/writing-summary
 *
 * Build-time JSON export for lindowlabs.dev (numbers only).
 * Auth: Authorization: Bearer <WRITING_SUMMARY_TOKEN>
 *
 * Returns weekly flow minutes, time to first word, revision rate, and
 * prompt rankings. No draft text, no context tags, no timestamps finer
 * than the calendar day.
 *
 * Env (Vercel Production + Preview for tinker.beginner.work):
 *   WRITING_SUMMARY_TOKEN — shared secret; also set the same value in
 *   the lindowlabs.dev build env so that site can pull at build time.
 *   METRICS_OWNER_ALLOWLIST — must include Tyler's Stytch user id(s);
 *   export is scoped to those owners only.
 */

"use strict";

const { withResponseLogging } = require("./_lib/log.js");
const analytics = require("./_lib/analytics.js");

function extractBearer(header) {
  if (!header || typeof header !== "string") return "";
  const m = header.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : "";
}

function tokenConfigured() {
  return String(process.env.WRITING_SUMMARY_TOKEN || "").trim();
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length) return false;
  // Node crypto.timingSafeEqual requires equal lengths.
  const crypto = require("node:crypto");
  return crypto.timingSafeEqual(left, right);
}

module.exports = withResponseLogging(async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const expected = tokenConfigured();
  if (!expected) {
    res.status(503).json({
      error: "WRITING_SUMMARY_TOKEN is not configured on this deploy.",
    });
    return;
  }

  const got = extractBearer(req.headers && req.headers.authorization);
  if (!got || !timingSafeEqual(got, expected)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.method === "HEAD") {
    res.status(200).end();
    return;
  }

  try {
    const summary = await analytics.writingSummaryExport();
    res.status(200).json(summary);
  } catch (err) {
    res.status(503).json({ error: err.message || "Unavailable" });
  }
});
