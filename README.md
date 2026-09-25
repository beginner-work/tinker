# tinker

tinker — a quiet place to be on the web.

A minimal desktop browser built on Electron, with a Vercel-hosted web
app and Expo native shells that share the same renderer. The chrome
wears tinker's multi-colored globe mark on a warm cream background,
with Plus Jakarta Sans for display and Inter for body.

## What's in this repo

This is one full product app — there is no separate MCP repo anymore.
The core surfaces live here together:

- **Front ends** — web (Vercel) and native mobile (Expo), plus the
  Electron desktop shell. All three share `src/renderer/`.
- **Product back ends** — the non-payments / non-identity systems under
  `api/` (Claude, search, pitches, publish, feed, user-data, voice,
  email, and the rest of the product surface).
- **Developer-facing APIs** — that same `api/` layer is what agents and
  tooling call. `/api/mcp` is a Streamable HTTP MCP façade on this
  deploy (follow-up questions and LinkedIn drafts). Project MCP config
  (e.g. Browserbase) is for debugging against this app. Neither one is
  the beginner mail/domains Worker.

Payments (Stripe) and identity (Stytch) stay as external services wired
in where the product needs them. They are not carved out into their own
repos either — just not what this tree *is*.

## Run it (desktop)

```bash
npm install
export ANTHROPIC_API_KEY="sk-ant-..."   # required for search
npm start
```

Use `npm run dev` to open with DevTools attached.

## Build it (desktop)

To package the desktop app into a distributable, use
[electron-builder](https://www.electron.build) — configured in
[`electron-builder.yml`](electron-builder.yml):

```bash
npm install
npm run dist          # package for the current OS
npm run pack          # unpacked dir only, for a quick smoke test
```

Artifacts land in `dist/` (git-ignored). Each OS builds its own formats,
so build on the matching platform (or a CI runner per platform):

| Script | Host OS | Output |
|--------|---------|--------|
| `npm run dist:linux` | Linux | `tinker-<version>-x86_64.AppImage`, `tinker-<version>-x64.tar.gz` |
| `npm run dist:mac` | macOS | `.dmg` + `.zip` |
| `npm run dist:win` | Windows (or Linux + wine) | NSIS installer + portable `.exe` |

The renderer + main process are plain JS with nothing to compile, so the
build just collects `src/main/` + `src/renderer/` and the one runtime
dependency the desktop main needs (`@anthropic-ai/sdk`) into an asar — the
Prisma tree that belongs to the web / API variant is left out. The Linux
`.desktop` entry's `StartupWMClass` is synced to the app's
`desktopName` so window managers group tinker's windows under its launcher.

### Releasing

Pushing a version tag builds every desktop installer on its native runner
(macOS / Linux / Windows) and uploads them to a GitHub Release — see
[`.github/workflows/release.yml`](.github/workflows/release.yml):

```bash
npm version patch        # bumps package.json + creates the v* tag
git push --follow-tags   # triggers the Release workflow
```

A release can also be cut **by PR**, for sessions that can merge to main but
can't push tags: bump `version` in `package.json` and `.release-version` to
the same value in the PR. When the merge lands on main,
[`release-on-marker.yml`](.github/workflows/release-on-marker.yml) verifies
the two match and runs the same Release workflow with publishing on.

macOS produces a single **universal** `tinker-mac.dmg` (Intel + Apple
Silicon) under a stable name, so the beginner landing page can link straight
to `releases/latest/download/tinker-mac.dmg`. To ship a Gatekeeper-clean
build (no "unidentified developer" warning), add the Apple signing secrets
to the repo — `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; without them the build still
ships, just unsigned. Note that release assets inherit the repo's
visibility, so a public download needs the asset hosted somewhere public.

## Run it (web)

The same `src/renderer/` codebase ships as a hosted website — no build step.
The web build is phone-OTP-gated via [Stytch](https://stytch.com); search
runs through a Vercel function that holds the Anthropic key.

For local dev with the auth flow, use Vercel's local emulator instead of
the plain static host:

```bash
npm install
npx vercel link     # one-time; pick beginner-work / tinker
npx vercel env pull # pulls STYTCH_PROJECT_ID, STYTCH_SECRET, ANTHROPIC_API_KEY
npx vercel dev      # serves http://localhost:3000 with /api/* functions
```

For static-only browsing (no auth, no search) you can still run the bundled
host:

```bash
npm run web         # serves http://localhost:5173 (static only)
```

The web build doesn't ask for an Anthropic key. Instead it gates the app
behind a phone/PIN sign-in: enter your phone, receive a 6-digit code,
verify it. Sign-up and login share the same screen — first-time users get
a Stytch user created automatically when they verify.

The flow is:

1. The browser POSTs `/api/auth/phone/request` with the phone number.
2. The Vercel function calls Stytch's `otps/sms/login_or_create` with
   project credentials and returns the `phone_id` to the browser.
3. The browser POSTs `/api/auth/phone/verify` with `{ phone_id, pin }`. The
   function calls Stytch's `otps/authenticate` with a 30-day session
   duration and returns the Stytch `session_jwt` as `token`. The browser
   stores it under `tinker_jwt` in `localStorage`.
4. Subsequent searches POST `/api/search` with the JWT as a Bearer token;
   the function verifies the JWT against Stytch's JWKS, then calls
   Claude Haiku 4.5 with the server-side Anthropic key. The browser
   bundle never sees the Anthropic key.

Required Vercel env vars:

- `STYTCH_PROJECT_ID`
- `STYTCH_SECRET`
- `ANTHROPIC_API_KEY`
- `DATABASE_URL`
- `STRIPE_SECRET_KEY` — the **live** secret key for the Stripe account that
  holds the pre-seed subscriptions. Required by the membership endpoints
  (`api/membership/checkout.js`, `reconcile.js`, `pause.js`, `status.js`).
  Without it, in-app Upgrade returns 503, **"Already subscribed? Restore" can
  never link a subscription** — the reconcile call 503s and the row stays on
  "Free plan" — and Pause/Resume returns 503. A test-mode key here is just as
  broken: it queries the wrong Stripe
  account, finds no customer, and reports the paying member as free. This must
  be the **same** live account `beginner`'s checkout writes to.
- `BROWSERBASE_API_KEY` — used by `scripts/browserbase-debug.js`
- `BROWSERBASE_PROJECT_ID` — used by `scripts/browserbase-debug.js`

Optional:

- `STRIPE_PRICE_PRESEED` — a recurring $9/month Price id for the in-app
  Upgrade checkout. If unset, the checkout builds the price inline, so the
  flow still works without dashboard setup.
- `BEGINNER_MCP_TOKEN` (or `CLOUDFLARE_API_TOKEN`) — enables the in-app email
  composer (profile menu → "Send an email", `api/email/send.js`). The function
  relays to the beginner mcp Worker's `POST /email/send` (canonical URL
  `https://beginner-mcp.tyler-lindow.workers.dev`, hardcoded default;
  `BEGINNER_MCP_URL` overrides), which sends from the founder's
  `beginner.work` address via Cloudflare Email Routing. The bearer can be the
  Worker's `MCP_BEARER_TOKEN` or — since the Worker accepts it on the email
  route — the account's default `CLOUDFLARE_API_TOKEN`, so an existing secret
  can be reused as-is. No token → the composer gets a friendly 503. Inherited
  constraint: Email Routing only delivers to **verified destination
  addresses** on the Cloudflare account.

Optional Preview-only vars (enable the Claude-Code → Browserbase loop;
see "Closed-loop iteration on a Vercel preview" below):

- `VERCEL_AUTOMATION_BYPASS_SECRET` — auto-set when you enable Protection Bypass
- `TEST_AUTH_TOKEN` — gates `/api/dev-bootstrap`
- `TEST_SESSION_TOKEN` — long-lived Stytch `session_token` for the test user
- `TEST_PHONE_NUMBER` — E.164 number for the test account; used by `scripts/mint-test-session.js`

Set the same values for Production and Preview so preview deploys see the
same Stytch users and the same Postgres rows as production. (Preview used
to point at a separate `project-test-*` Stytch project and got its
localStorage wiped on every load — both are gone now; previews behave
like a second URL pointing at production.)

### Autonomy

`/autonomy` stores each signed-in person's toggles in Upstash Redis, not Postgres. One hash per Stytch user id, named `autonomy:<user id>`. The id comes from the verified session. Each field is one of the 14 item keys, and the value is JSON with `autonomous`, `note`, `updated_by`, and `updated_at`. A save writes that one field, so two toggles do not overwrite each other.

Both `GET /api/autonomy` and `PUT /api/autonomy/:key` require a signed-in session. A signed-out request is 401. There is no public list and no allowlist. A person with nothing stored yet reads every item off, including LinkedIn profile edits. There is no seed.

Connect the store on the Vercel project environment. The Marketplace may set either pair. The app uses the first pair that is fully set:

- `KV_REST_API_URL` and `KV_REST_API_TOKEN`
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`

The app does not log the URL or the token, and it does not put them in an error. If the store is missing or cannot be reached, GET still returns 200 and every item is off. PUT returns 503 with `Autonomy settings are unavailable right now.` and writes nothing.

### Shared database with the beginner repo

`DATABASE_URL` on both tinker (production + preview) and beginner
production points at the same Neon endpoint
(`ep-delicate-art-ak2qmsls-pooler`). `TinkerUserData` is the shared
row store — see `beginner/CLAUDE.md` → "Database topology". One
asymmetry: beginner's Vercel project has Neon preview-branching
enabled, so a **beginner preview** reads from a fresh per-deploy
branch, not the production DB. Cross-project flows (e.g. publishing a
pitch from tinker preview to `/daily/` on beginner preview) therefore
won't round-trip in preview; verify on production after merge.

Sign out by clearing `tinker_jwt` (`window.tinkerAuth.signOut()` from the
inspector, or `localStorage.removeItem("tinker_jwt")`).

## Debugging preview deploys

When a Vercel preview misbehaves in a way you can't reproduce locally —
auth flow only breaks behind the edge network, a third-party widget only
loads from a non-localhost origin, etc. — there are two ways to point a
real Chromium at the preview through [Browserbase](https://browserbase.com).

### From Claude Code (recommended)

`.mcp.json` points at Browserbase's hosted MCP server. The next time
you open this repo in Claude Code you'll be asked to approve the
project-scoped MCP once — accept it and Claude gets `navigate`,
`act`, `observe`, and `extract` tools wired up to a cloud Chromium.
Ask Claude something like "open the latest preview and tell me what's
printed in the console" and it'll spin up a session and look for you.

The hosted server handles its own LLM costs (Browserbase pays for
Gemini under the hood); all you need is `BROWSERBASE_API_KEY` set in
your Claude Code environment. The key is passed as a URL query
param — no extra model key, no Anthropic key, no Gemini key.

### Closed-loop iteration on a Vercel preview

For the full edit → push → preview → poke → fix loop, Claude needs to
get past two auth walls in a single browser navigation:

1. Vercel's "Authentication Required" page on protected previews.
2. The app's own Stytch SMS-OTP gate.

The repo handles both with one URL:

```
https://<preview>.vercel.app/api/dev-bootstrap
  ?test_auth=$TEST_AUTH_TOKEN
  &x-vercel-protection-bypass=$VERCEL_AUTOMATION_BYPASS_SECRET
  &x-vercel-set-bypass-cookie=true
  &next=/
```

Vercel consumes the bypass query params at the edge (and sets a
`_vercel_jwt` cookie so subsequent navigations on the same session don't
need them). The function then validates `test_auth` and returns a tiny
HTML page that writes a pre-minted Stytch session token into
`localStorage.tinker_jwt` and redirects to `/`. From there the app is
fully authenticated and Claude can use the Browserbase MCP tools
(`navigate`, `act`, `observe`, `extract`) against the real preview.

One-time setup:

1. Vercel dashboard → Settings → Deployment Protection → enable
   **Protection Bypass for Automation**. This auto-adds
   `VERCEL_AUTOMATION_BYPASS_SECRET` to project env.
2. Add three Preview-scope env vars:

   ```
   vercel env add TEST_PHONE_NUMBER preview    # e.g. +15551234567
   vercel env add TEST_AUTH_TOKEN  preview     # any 32+ char random string
   vercel env add TEST_SESSION_TOKEN preview   # see step 3
   ```

3. Mint the long-lived session token (rerun every ~30 days):

   ```bash
   npx vercel env pull
   node scripts/mint-test-session.js
   # Triggers an SMS to TEST_PHONE_NUMBER, prompts for the 6-digit code,
   # prints the session_token plus the exact `vercel env add` command to
   # paste it into the Preview scope. Then redeploy.
   ```

These vars only exist in the Preview scope on purpose: production stays
unaware of them, so the `/api/dev-bootstrap` endpoint silently 404s on
the production hostname.

### Testing on a preview as yourself, without re-sending SMS

Because preview shares the **Live** Stytch project and the production
Postgres (see above), signing into a preview lands you on your real
production account with real production data — that's the point, and
it's why preview must *not* be pointed back at a `project-test-*`
project (that would isolate you onto an empty test user). The catch:
every preview deploy is a new `*.vercel.app` origin with empty
localStorage, so the SMS-OTP gate makes you sign in again on each one.
Each sign-in sends a Stytch code, and after ~24 sends in 24h Stytch
rate-limits your number.

The same `/api/dev-bootstrap` seam that automation uses fixes this for
humans too: it reuses the one long-lived `TEST_SESSION_TOKEN` (your real
Live session, minted once in step 3 above) instead of triggering a new
code. Mint it once per ~30 days, then on each new preview origin:

```bash
npx vercel env pull                  # populates TEST_AUTH_TOKEN + bypass secret
npm run preview:url -- --url https://tinker-abc.vercel.app
# prints the /api/dev-bootstrap URL — open it in your browser and you're
# signed in as your production account, no SMS. Pass --next /daily/ to
# land on a specific path.
```

So the rule of thumb for real-account preview testing: **mint once with
your real phone, then re-seed with `preview:url` — never re-run the OTP
just to get back in.** That keeps you on your real Live user and real
production data while staying well clear of the 24-in-24h SMS wall.

### Secrets in Claude Code on the web

Vercel stays the source of truth for everything else.
`.claude/hooks/session-start.sh` runs at the start of each cloud Claude
Code session, pulls the Preview env from Vercel, and exposes it to the
session so `.mcp.json`'s `${BROWSERBASE_API_KEY}` placeholder
interpolates correctly when the Browserbase MCP server starts. The hook
needs three bootstrap vars in the Claude Code web environment for this
repo (the only secrets that can't live in Vercel):

- `VERCEL_TOKEN`       — a read-only-by-default Vercel API token
- `VERCEL_PROJECT_ID`  — copy from `.vercel/project.json` after a local `vercel link`
- `VERCEL_ORG_ID`      — same file

Without them, the hook still installs npm deps and exits cleanly, so
local `claude` runs that already have `.env.local` on disk are
unaffected.

### From your terminal

For human-driven poking around — when you want the Network tab in your
own browser pointed at a live preview — use the CLI script. It prints a
live DevTools URL you open locally:

```bash
npx vercel env pull            # pulls BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID
npm run debug:preview -- --url https://tinker-abc.vercel.app
```

The session auto-expires after 10 minutes of inactivity. Pass
`--timeout 3600` for a longer session, or `--help` to see all flags.

## Search

The address-bar / welcome-page search uses Claude Haiku 4.5 instead of
a third-party engine. Queries are answered as short essays — three to
five paragraphs of plain prose with embedded links to real sites you
can click through to. The Anthropic system prompt is marked for prompt
caching, so repeat queries skip the cold-start cost.

If `ANTHROPIC_API_KEY` isn't set, the search pane shows a friendly
error explaining how to fix it.

## MCP

Add this URL in the connector:

```
https://tinker.beginner.work/api/mcp
```

A client that speaks MCP OAuth gets a 401 whose `WWW-Authenticate` header points at the protected-resource metadata. It registers any https redirect URI, or an http loopback, with no client secret and no host allowlist. Tinker sends you to sign in, then one Approve button. The browser goes straight back to the client's redirect URI with `code` and `state`. The token response is `access_token` and `token_type` of `Bearer`, plus the `resource`. There is no `expires_in` and no refresh token. The client stores the credential. You do not paste a sign-in token.

Revoke from **MCP access** in the profile menu, or open `/mcp/access`. A revoked credential fails on the next request.

The happy path is authorization code with PKCE S256 and dynamic client registration. The access token is an opaque `mcp_` bearer. The server stores a SHA-256 hash, a label, and the time it was created or revoked. It does not keep the plaintext, and it does not issue a refresh token. The credential lasts until you revoke it.

Clients that cannot finish that redirect, and only accept a static `Authorization` header, use the same MCP access page. Create a credential there. It is shown once, for that header only.

```
Authorization: Bearer mcp_...
```

The credential belongs to the tinker account that approved it. MCP access lists and revokes only that account's credentials. The writing app's own sign-in can still call `/api/mcp`. That path is for the app, not for a connector.

The endpoint is stateless JSON. A missing or revoked bearer is 401. Authenticated GET and DELETE return 405. There is no server-push session.

Tools:

- `ask_followups`. Pass a founder `transcript` (`[{ "q", "a" }]`, or
  `[]` to open the interview) and the server runs the same interview
  contract the writing UI uses. The result is JSON:
  `{ mode, next_question, questions, stitched_title, stitched_body, done }`.
  Pass a freeform `draft` string instead (not both) for three to five
  learning questions. Optional `priorTurns` avoids repeats. Optional
  `seed`, `facing`, `lastPurchased`, `voice`, `transactions`, and
  `uncoveredSlides` are the same scene cues the browser interview
  already sends. `forceStitch: true` asks for the essay instead of
  another question.
- `draft_linkedin_post`. Pass `notes` (a topic or bullets) and the
  server drafts a LinkedIn post in Tyler's voice for Elevating Developer
  Fintech: short plain sentences, contractions OK, no em dashes. Pass
  `kind: "dm"` for a direct message (or start the notes with `DM:`).
  Pass `currentDraft` to revise, and an optional `instruction` for what
  to change. The result is `{ post, revised, kind }`. The tool returns
  copy only. It does not post to LinkedIn; Stanley still posts.

There is no raw `converse` tool. Clients cannot supply a system prompt.
The interview prompt lives in `src/renderer/interview-prompt.js` and is
what both the browser and `ask_followups` use. The LinkedIn prompt lives
in `api/_lib/linkedin-draft.js` and is what both the in-app composer and
`draft_linkedin_post` use. The writing UI still checks that a stitched
essay uses only the founder's words before it publishes. MCP returns the
model's JSON; it does not publish.

`/api/mcp` uses the existing `STYTCH_PROJECT_ID`, `STYTCH_SECRET`,
`ANTHROPIC_API_KEY`, and `DATABASE_URL`. The credential tables are
created on first use if `prisma migrate deploy` has not been run.
`BEGINNER_MCP_TOKEN` / `BEGINNER_MCP_URL` are only the in-app email
relay to the beginner Worker. They are not this endpoint.

## LinkedIn drafts

The sidebar row **LinkedIn draft** opens on the writing stage — the
same header, card, inputs, and pill buttons as an essay. Topic or
bullet notes in, a post out. Start the notes with `DM:` (or pass
`kind: "dm"` on the API) for a direct message. Revise by editing the
draft (or adding "what to change") and submitting again. Copy the
result; posting still goes through Stanley.

The shared prompt in `api/_lib/linkedin-draft.js` is the only voice.
It asks for short plain sentences, Tyler's Elevating Developer Fintech
niche, and no em dashes (periods, commas, parentheses, or separate
sentences). A caller cannot replace that system prompt. If the model
still returns an em dash, the server rewrites it before the copy is
returned.

The panel calls the existing converse proxy with `mode: "linkedin"`.
That mode ignores any client system prompt and runs
`draftLinkedInPost` in `api/_lib/linkedin-draft.js`. The MCP tool calls
the same function. No new serverless route.

Try it locally with the auth emulator (static `npm run web` has no
`/api`):

```bash
npx vercel dev      # http://localhost:3000
```

Sign in, open **LinkedIn draft** in the sidebar, and submit a few
bullets. A connector that has been approved calls the same tool:

```bash
curl -s https://tinker.beginner.work/api/mcp \
  -H "Authorization: Bearer mcp_..." \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"draft_linkedin_post","arguments":{"notes":"A portal is where a buyer decides to trust you."}}}'
```

## Mobile (Expo)

Native iOS / Android builds ship via [Expo](https://expo.dev), wrapping
the same `src/renderer/` web surface that Vercel hosts. Capacitor is no
longer part of this repo — there is no `capacitor.config.json`, no
`@capacitor/*` packages, and no `mobile:*` npm scripts.

| | Electron desktop | Web (Vercel) / Expo |
|---|---|---|
| Tabs / sessions | Yes — left sidebar | Yes (collapsed rail on phones) |
| In-app browsing | Native `<webview>` | External — opens in the system browser |
| Search / Claude | IPC → main process → Anthropic SDK | Same-origin `/api/*` on Vercel, JWT-gated |
| Auth | Local `ANTHROPIC_API_KEY` env var | Phone/PIN via Stytch (`tinker_jwt`) |

The `src/renderer/platform-mobile.js` shim detects the runtime —
Electron preload short-circuits it; on the plain web (and inside the
Expo shell) it polyfills the same `window.tinker.*` surface so the rest
of the renderer code path is identical.

## Style dictionary

The desktop-app icon (the multi-colored globe mark) is rendered from
`src/renderer/tokens/rainbow-web.json` — a JSON design dictionary.
The renderer fetches it via `src/renderer/lib/rainbow-web.js`, which
exposes `window.tinkerLogo.buildRainbowWebSvg()` for any consumer
that wants the mark as an SVG string.

## What's inside

```
.
├── api/                 # Product + developer-facing APIs (Vercel)
│   ├── auth/            # Phone/PIN via Stytch (identity wire-up)
│   ├── claude/          # Proxied Claude converse (linkedin mode included)
│   ├── mcp.js           # Streamable HTTP MCP (ask_followups, draft_linkedin_post)
│   ├── mcp-oauth.js     # MCP authorize, token, and revoke
│   ├── _lib/linkedin-draft.js  # Shared LinkedIn prompt + draft call
│   ├── search.js        # Search essays
│   ├── pitches/ …       # Pitch / publish / feed / user-data / …
│   └── membership/ …    # Stripe membership wire-up
├── src/
│   ├── main/            # Electron main + preload
│   ├── renderer/        # Shared web / Expo / Electron UI
│   └── web/             # Static local host (`npm run web`)
├── prisma/              # Shared Postgres schema
└── package.json
```

The renderer is plain HTML/CSS/JS — no build step, no bundler. Each
Electron tab maps to either the welcome page (in-DOM) or a
`<webview>` mounted lazily on first navigation. Web and Expo load the
same `src/renderer/` files against the Vercel `api/` back end.

## Shortcuts

| Action | Shortcut |
|--------|----------|
| New tab | ⌘/Ctrl + T |
| Close tab | ⌘/Ctrl + W |
| Focus address bar | ⌘/Ctrl + L |
| Reload | ⌘/Ctrl + R |
| Close tab (mouse) | Middle-click the tab |

The address bar accepts URLs, hostnames, and search queries
(anything else falls through to Google).
