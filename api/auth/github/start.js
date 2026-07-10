/* GET /api/auth/github/start[?provider=github|linkedin]
 *
 * Reply: { url, linked }  — the Stytch-hosted OAuth start URL the
 * browser should navigate to. `provider` defaults to github (the
 * route keeps its historical name); linkedin rides the exact same
 * flow minus the repo scopes. Returning JSON (instead of 302ing
 * directly) lets the auth gate surface a friendly message when the
 * flow isn't configured, rather than stranding the user on an error
 * page mid-redirect.
 *
 * Account linking: when the request carries a valid Bearer session
 * (an already-signed-in user connecting a provider), we mint a
 * one-shot oauth_attach_token so Stytch links the provider to that
 * existing user instead of creating a second account. `linked: true`
 * in the reply says the round-trip will attach. Without a (valid)
 * session the flow is a plain sign-in/sign-up.
 *
 * The public token comes from STYTCH_PUBLIC_TOKEN when set, else from
 * the checked-in fallback for the known project — public tokens are
 * client-visible by design (Stytch ships them in browser bundles), so
 * committing one is safe, and it means every deployment with
 * STYTCH_PROJECT_ID behaves the same with zero extra env config. The
 * GitHub OAuth provider must still be enabled in the Stytch dashboard
 * (see docs/github-signin.md). Unconfigured deployments degrade to a
 * 503 and the gate falls back to phone-only.
 *
 * `custom_scopes=repo` asks GitHub for repository access so the
 * post-sign-in picker can list private repos too; the picker is where
 * the developer decides which of those repos tinker actually uses.
 */

"use strict";

const { baseUrlFor, attachOauth } = require("../../_lib/stytch.js");
const { extractBearer } = require("../../_lib/user-data.js");
const { withResponseLogging } = require("../../_lib/log.js");

// Public (not secret) tokens, keyed by project so a test-project
// deployment never borrows the live token by accident.
const PUBLIC_TOKEN_FALLBACKS = {
  "project-live-ce45a753-a6a3-4af2-b25b-6be3aa6d8c34":
    "public-token-live-6387bc22-d8b7-43d9-ac28-ea82915c2255",
};

// Providers the gate offers, with the extra scopes each needs. GitHub
// asks for repo access so the picker can list private repos; LinkedIn
// uses the provider defaults configured in the Stytch dashboard.
const PROVIDERS = {
  github: { scopes: "repo read:user", label: "GitHub" },
  linkedin: { scopes: "", label: "LinkedIn" },
};

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const query = new URL(req.url || "/", "http://localhost").searchParams;
  const provider = (query.get("provider") || "github").toLowerCase();
  if (!PROVIDERS[provider]) {
    res.status(400).json({ error: `Unknown provider "${provider}".` });
    return;
  }

  const projectId = process.env.STYTCH_PROJECT_ID;
  const publicToken =
    process.env.STYTCH_PUBLIC_TOKEN || PUBLIC_TOKEN_FALLBACKS[projectId] || "";
  if (!projectId || !publicToken) {
    res.status(503).json({
      error: `${PROVIDERS[provider].label} sign-in isn't configured on this deployment.`,
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

  const url = new URL(
    baseUrlFor(projectId) + `/v1/public/oauth/${provider}/start`,
  );
  url.searchParams.set("public_token", publicToken);
  url.searchParams.set("login_redirect_url", callback);
  url.searchParams.set("signup_redirect_url", callback);
  if (PROVIDERS[provider].scopes) {
    url.searchParams.set("custom_scopes", PROVIDERS[provider].scopes);
  }

  // Link rather than fork: a signed-in caller gets an attach token.
  // Best-effort — a stale session just falls back to plain sign-in
  // rather than blocking the button.
  let linked = false;
  const bearer = extractBearer(req.headers && req.headers.authorization);
  if (bearer) {
    try {
      const attach = await attachOauth(provider, bearer);
      if (attach && attach.oauth_attach_token) {
        url.searchParams.set("oauth_attach_token", attach.oauth_attach_token);
        linked = true;
      }
    } catch {
      /* fall back to plain sign-in */
    }
  }

  res.status(200).json({ url: url.toString(), linked });
});
