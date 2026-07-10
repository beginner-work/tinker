/* GET /api/auth/github/callback?token=...
 *
 * Where Stytch lands after the GitHub OAuth round-trip. Exchanges the
 * one-shot token for a 30-day session, stashes the GitHub connection
 * (access token, scopes) in the user's TinkerUserData row, then 302s
 * back to the app with the session token in the URL *fragment* —
 * fragments never reach servers or logs, and auth.js strips it from
 * the address bar immediately after storing it.
 *
 *   success → /#gh=<session_token>&gh_new=0|1
 *   failure → /#gh_error=<message>
 *
 * The GitHub access token itself stays server-side; the browser only
 * ever sees the Stytch session token, same as the phone flow.
 */

"use strict";

const { authenticateOauth } = require("../../_lib/stytch.js");
const prisma = require("../../_lib/db.js");
const { withResponseLogging } = require("../../_lib/log.js");

const GITHUB_KIND = "github";

// Same best-effort signup inference as api/auth/phone/verify.js —
// Stytch doesn't say "first time" directly, so a user record created
// in the last two minutes is treated as a signup.
function looksFreshlyCreated(stytchUser) {
  if (!stytchUser || typeof stytchUser.created_at !== "string") return false;
  const createdAt = Date.parse(stytchUser.created_at);
  if (Number.isNaN(createdAt)) return false;
  return Date.now() - createdAt < 2 * 60 * 1000;
}

function redirectHome(res, hash) {
  res.statusCode = 302;
  res.setHeader("Location", `/#${hash}`);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

module.exports = withResponseLogging(async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  const token = url.searchParams.get("token") || "";
  if (!token) {
    redirectHome(
      res,
      "gh_error=" + encodeURIComponent("GitHub sign-in was cancelled."),
    );
    return;
  }

  let stytch;
  try {
    stytch = await authenticateOauth(token);
  } catch (err) {
    redirectHome(
      res,
      "gh_error=" + encodeURIComponent(err.message || "GitHub sign-in failed."),
    );
    return;
  }

  if (!stytch.session_token) {
    redirectHome(
      res,
      "gh_error=" + encodeURIComponent("Stytch returned no session token."),
    );
    return;
  }

  // Persist the GitHub connection so /api/auth/github/repos can list
  // repositories later. Best-effort: a hiccup here must not eat the
  // sign-in — the repo picker will report it and offer Skip.
  const userId =
    (stytch.user && stytch.user.user_id) ||
    (stytch.session && stytch.session.user_id) ||
    "";
  const providerValues = stytch.provider_values || {};
  if (userId && providerValues.access_token) {
    try {
      const existing = await prisma.tinkerUserData.findUnique({
        where: { userId_kind: { userId, kind: GITHUB_KIND } },
      });
      const prior =
        existing && existing.data && typeof existing.data === "object"
          ? existing.data
          : {};
      const data = {
        provider: "github",
        providerSubject:
          stytch.provider_subject || prior.providerSubject || "",
        accessToken: providerValues.access_token,
        scopes: Array.isArray(providerValues.scopes)
          ? providerValues.scopes
          : [],
        connectedAt: new Date().toISOString(),
        // A returning developer keeps their previous repo selection.
        selectedRepos: Array.isArray(prior.selectedRepos)
          ? prior.selectedRepos
          : [],
      };
      await prisma.tinkerUserData.upsert({
        where: { userId_kind: { userId, kind: GITHUB_KIND } },
        create: { userId, kind: GITHUB_KIND, data },
        update: { data },
      });
    } catch {
      /* connection storage is best-effort */
    }
  }

  const isNew = looksFreshlyCreated(stytch.user);
  redirectHome(
    res,
    `gh=${encodeURIComponent(stytch.session_token)}&gh_new=${isNew ? 1 : 0}`,
  );
});
