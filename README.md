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
  tooling call; project MCP config (e.g. Browserbase) is for debugging
  against this app, not a sibling product repo.

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
│   ├── claude/          # Proxied Claude converse
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
