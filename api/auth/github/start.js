/* GET /api/auth/github/start
 *
 * Reply: { url }  — the Stytch-hosted GitHub OAuth start URL the
 * browser should navigate to. Returning JSON (instead of 302ing
 * directly) lets the auth gate surface a friendly message when the
 * flow isn't configured, rather than stranding the user on an error
 * page mid-redirect.
 *
 * Requires STYTCH_PUBLIC_TOKEN alongside the existing
 * STYTCH_PROJECT_ID, plus the GitHub OAuth provider being enabled in
 * the Stytch dashboard (see docs/github-signin.md). Without them this
 * endpoint degrades to a 503 and the gate falls back to phone-only.
 *
 * `custom_scopes=repo` asks GitHub for repository access so the
 * post-sign-in picker can list private repos too; the picker is where
 * the developer decides which of those repos tinker actually uses.
 */

"use strict";

const { baseUrlFor } = require("../../_lib/stytch.js");
const { withResponseLogging } = require("../../_lib/log.js");

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const projectId = process.env.STYTCH_PROJECT_ID;
  const publicToken = process.env.STYTCH_PUBLIC_TOKEN;
  if (!projectId || !publicToken) {
    res.status(503).json({
      error: "GitHub sign-in isn't configured on this deployment.",
    });
    return;
  }

  const host =
    (req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) ||
    "";
  if (!host) {
    res.status(400).json({ error: "Missing Host header." });
    return;
  }
  const proto =
    (req.headers && req.headers["x-forwarded-proto"]) ||
    (host.startsWith("localhost") || host.startsWith("127.")
      ? "http"
      : "https");
  const callback = `${proto}://${host}/api/auth/github/callback`;

  const url = new URL(baseUrlFor(projectId) + "/v1/public/oauth/github/start");
  url.searchParams.set("public_token", publicToken);
  url.searchParams.set("login_redirect_url", callback);
  url.searchParams.set("signup_redirect_url", callback);
  url.searchParams.set("custom_scopes", "repo read:user");

  res.status(200).json({ url: url.toString() });
});
