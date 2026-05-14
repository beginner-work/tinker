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
 * Cached briefly at the edge so polling clients don't invoke the
 * function on every check.
 */

"use strict";

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

  res.setHeader(
    "Cache-Control",
    "public, max-age=0, s-maxage=30, stale-while-revalidate=60"
  );
  res.status(200).json({ version, sha, deploymentId, env });
};
