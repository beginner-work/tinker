/* GET /api/version
 *
 * Returns an opaque string that changes every time a new build is
 * deployed to production. The renderer (src/renderer/update-banner.js)
 * polls this endpoint, compares against the version it loaded with,
 * and surfaces a top banner inviting the user to reload when the
 * deploy SHA has moved on.
 *
 * Vercel injects VERCEL_GIT_COMMIT_SHA at runtime for every deployment
 * built from a git commit. We fall back to VERCEL_DEPLOYMENT_ID for
 * deploys that didn't originate from git (e.g. CLI uploads), and to
 * the literal "dev" when neither is present (local `vercel dev`,
 * `node src/web/server.js`, etc.) — in that case the version stays
 * constant so the banner never fires.
 *
 * `summary` is the human-readable headline the banner shows. Defaults to
 * "Bug fixes". For a true feature release, set RELEASE_HEADLINE on the
 * deployment to a short phrase (4–6 words, e.g. "Sidebar liquid-glass
 * effect") and the banner picks it up instead.
 *
 * Cached briefly at the edge so polling clients don't invoke the
 * function on every check.
 */

"use strict";

const DEFAULT_SUMMARY = "Bug fixes";
const SUMMARY_MAX = 60;

function readSummary() {
  const raw = process.env.RELEASE_HEADLINE;
  if (typeof raw !== "string") return DEFAULT_SUMMARY;
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_SUMMARY;
  return trimmed.length > SUMMARY_MAX ? trimmed.slice(0, SUMMARY_MAX - 1) + "…" : trimmed;
}

module.exports = function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const sha = process.env.VERCEL_GIT_COMMIT_SHA || "";
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || "";
  const env = process.env.VERCEL_ENV || "development";
  const version = sha || deploymentId || "dev";
  const summary = readSummary();

  res.setHeader(
    "Cache-Control",
    "public, max-age=0, s-maxage=30, stale-while-revalidate=60"
  );
  res.status(200).json({ version, sha, deploymentId, env, summary });
};
