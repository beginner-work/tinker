/* GET /api/auth/github/callback?token=...
 *
 * Where Stytch lands after an OAuth round-trip — GitHub or LinkedIn,
 * both providers share this callback (the route keeps its historical
 * name). Exchanges the one-shot token for a 30-day session, stashes
 * the provider connection (access token, scopes) in the user's
 * TinkerUserData row keyed by provider, then 302s back to the app with
 * the session token in the URL *fragment* — fragments never reach
 * servers or logs, and auth.js strips it from the address bar
 * immediately after storing it.
 *
 *   success → /#gh=<session_token>&gh_new=0|1&gh_provider=github|linkedin
 *   failure → /#gh_error=<message>
 *
 * The client uses gh_provider to decide the follow-up step (GitHub →
 * repo picker; LinkedIn → straight in). The provider access token
 * itself stays server-side; the browser only ever sees the Stytch
 * session token, same as the phone flow.
 */

"use strict";

const { authenticateOauth } = require("../../_lib/stytch.js");
const prisma = require("../../_lib/db.js");
const { withResponseLogging } = require("../../_lib/log.js");

// TinkerUserData kinds, one row per connected provider. Stytch's
// authenticate response says which provider the round-trip used.
const KNOWN_PROVIDERS = new Set(["github", "linkedin"]);

function providerFrom(stytch) {
  const raw = String(stytch.provider_type || "").toLowerCase();
  return KNOWN_PROVIDERS.has(raw) ? raw : "github";
}

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

  // Persist the provider connection (for GitHub, /api/auth/github/repos
  // reads it to list repositories). Best-effort: a hiccup here must not
  // eat the sign-in — the repo picker will report it and offer Skip.
  const provider = providerFrom(stytch);
  const userId =
    (stytch.user && stytch.user.user_id) ||
    (stytch.session && stytch.session.user_id) ||
    "";
  const providerValues = stytch.provider_values || {};
  if (userId && providerValues.access_token) {
    try {
      const existing = await prisma.tinkerUserData.findUnique({
        where: { userId_kind: { userId, kind: provider } },
      });
      const prior =
        existing && existing.data && typeof existing.data === "object"
          ? existing.data
          : {};
      const data = {
        provider,
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
        where: { userId_kind: { userId, kind: provider } },
        create: { userId, kind: provider, data },
        update: { data },
      });
    } catch {
      /* connection storage is best-effort */
    }
  }

  const isNew = looksFreshlyCreated(stytch.user);
  redirectHome(
    res,
    `gh=${encodeURIComponent(stytch.session_token)}&gh_new=${isNew ? 1 : 0}` +
      `&gh_provider=${provider}`,
  );
});
