# GitHub + LinkedIn sign-in

The auth gate offers **Continue with GitHub** and **Continue with
LinkedIn** alongside phone/PIN, riding the same endpoints (the
`/api/auth/github/*` routes keep their historical name; `?provider=`
picks the provider). GitHub is aimed at developers: after the OAuth
round-trip they land on a repo picker and choose which repositories
tinker may access. The selection is stored per user; everything they
don't pick stays off-limits to tinker's features even though the OAuth
grant itself is broader. LinkedIn has no follow-up step — verify and
you're in.

## How it works

```
gate ── Continue with GitHub
  → GET /api/auth/github/start            (returns Stytch's hosted start URL)
  → github.com authorize (scopes: repo read:user)
  → Stytch → GET /api/auth/github/callback?token=…
      · POST /v1/oauth/authenticate        (30-day session, same as phone)
      · stores { accessToken, scopes, selectedRepos } in TinkerUserData
        under kind "github" — the GitHub token never reaches the browser
  → 302 /#gh=<session_token>&gh_new=0|1    (fragment: never hits server logs)
      · auth.js stores the token under tinker_jwt, scrubs the hash,
        and shows the repo picker
  → GET/PUT /api/auth/github/repos         (list repos / save the selection)
```

The session token minted here is the same Stytch `session_token` the
phone flow hands out, so the Claude proxy, search, and user-data
endpoints all work unchanged.

## Account linking (linked OAuth)

A signed-in caller of `/api/auth/github/start` (Bearer session token —
the gate sends it automatically when one exists) gets a one-shot
`oauth_attach_token` minted via Stytch's `/v1/oauth/attach`, and the
OAuth round-trip then **links GitHub to that existing user** instead of
creating a second Stytch account. So a founder who signed up by phone
keeps one identity when they connect GitHub — same user id, same
essays, same membership row. A stale session silently falls back to
plain sign-in/sign-up. The repo picker offers "Connect GitHub to this
account" when a phone-signed-in user has no GitHub linked yet, and
`window.tinkerAuth.connectGitHub()` exposes the same flow to any future
settings surface. Linking needs no extra Stytch dashboard config — the
attach API is enabled by the same provider setup as sign-in.

## Configuration

Everything degrades gracefully when unconfigured: the button surfaces
"GitHub sign-in isn't configured on this deployment." and phone sign-in
is unaffected.

1. **Stytch dashboard → OAuth → GitHub** (the one manual step): create
   a GitHub OAuth app (github.com → Settings → Developer settings →
   OAuth Apps) whose **Authorization callback URL** is Stytch's live
   OAuth callback:

   ```
   https://api.stytch.com/v1/oauth/callback/oauth-callback-live-47cf4ec0-e78e-454f-b093-2643ae4280b0
   ```

   then paste the app's client id/secret into Stytch's GitHub provider
   config.

   **LinkedIn**: same shape — create an app at
   developer.linkedin.com (Products → "Sign In with LinkedIn using
   OpenID Connect"), set its authorized redirect URL to the same
   Stytch callback above, and paste its client id/secret into Stytch's
   LinkedIn provider config. Until then the LinkedIn button reports
   Stytch's "provider not configured" error and everything else keeps
   working.
2. **Redirect URLs** — already registered via the Stytch API for
   `https://tinker.beginner.work/api/auth/github/callback` (default)
   and `https://crafting-tinker.beginner.work/api/auth/github/callback`,
   both as Login + Signup types. Any new host needs its own entry.
3. **Public token** — no env config needed: the live project's public
   token (client-visible by design) is checked in as a fallback in
   `api/auth/github/start.js`, keyed by `STYTCH_PROJECT_ID` so a test
   project never borrows it. Setting `STYTCH_PUBLIC_TOKEN` on Vercel
   overrides the fallback.

Test-vs-live routing follows the existing convention: a
`project-test-*` project id sends the browser to `test.stytch.com`,
anything else to `api.stytch.com`.

## Data shape

`TinkerUserData` row, kind `github`:

```json
{
  "provider": "github",
  "providerSubject": "…",
  "accessToken": "gho_…",
  "scopes": ["repo", "read:user"],
  "connectedAt": "2026-07-10T…Z",
  "selectedRepos": ["owner/name", "owner/other"]
}
```

`selectedRepos` is the contract for any future feature that touches
GitHub on the user's behalf: read it, and ignore repos that aren't in
it. Re-authenticating refreshes `accessToken` but keeps the selection.
