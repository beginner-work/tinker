# tinker

tinker — a quiet place to be on the web.

A minimal desktop browser built on Electron, with mobile (Capacitor) and
plain-web variants that share the same renderer. The chrome wears tinker's
multi-colored globe mark on a warm cream background, with Plus Jakarta
Sans for display and Inter for body.

## Run it (desktop)

```bash
npm install
export ANTHROPIC_API_KEY="sk-ant-..."   # required for search
npm start
```

Use `npm run dev` to open with DevTools attached.

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
- `BROWSERBASE_API_KEY` — used by `scripts/browserbase-debug.js`
- `BROWSERBASE_PROJECT_ID` — used by `scripts/browserbase-debug.js`

Set the same values for Production and Preview so preview deploys see the
same Stytch users and the same Postgres rows as production. (Preview used
to point at a separate `project-test-*` Stytch project and got its
localStorage wiped on every load — both are gone now; previews behave
like a second URL pointing at production.)

Sign out by clearing `tinker_jwt` (`window.tinkerAuth.signOut()` from the
inspector, or `localStorage.removeItem("tinker_jwt")`).

## Debugging preview deploys

When a Vercel preview misbehaves in a way you can't reproduce locally —
auth flow only breaks behind the edge network, a third-party widget only
loads from a non-localhost origin, etc. — `scripts/browserbase-debug.js`
spins up a [Browserbase](https://browserbase.com) cloud Chromium pointed
at the preview URL. It prints a live debug URL you open in your own
browser to get full DevTools (Network, Console, Elements) against the
live deploy.

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

## Mobile (Capacitor)

The same `src/renderer/` codebase ships as an iOS / Android app via
[Capacitor](https://capacitorjs.com). One-time setup:

```bash
npm install
npx cap add ios          # macOS + Xcode required
npx cap add android      # Android Studio required
npx cap sync
```

Then either open the native project in its IDE…

```bash
npm run mobile:open:ios
npm run mobile:open:android
```

…or build and run on a connected device:

```bash
npm run mobile:run:ios
npm run mobile:run:android
```

`capacitor.config.json` points the web layer at `src/renderer/` — no
bundler, no build step. After editing renderer code, run
`npm run mobile:sync` to copy the latest `src/renderer/` into the
native projects.

### How the platforms differ

| | Electron desktop | Capacitor mobile / web |
|---|---|---|
| Tabs / sessions | Yes — left sidebar | Yes (collapsed rail on phones) |
| In-app browsing | Native `<webview>` | External — opens in iOS/Android system browser via `@capacitor/browser` |
| Search engine | IPC → main process → Anthropic SDK | Direct browser-side fetch with prompt caching |
| API key storage | `ANTHROPIC_API_KEY` env var | `localStorage` (open the inspector and run `localStorage.setItem(...)`) |

The `src/renderer/platform-mobile.js` shim detects the runtime —
Electron preload short-circuits it; on Capacitor and on the plain
web it polyfills the same `window.tinker.*` surface so the rest
of the renderer code path is identical.

### Setting keys on mobile

For now, paste the key into `localStorage` from the Capacitor
WebView inspector (Safari Web Inspector on iOS, `chrome://inspect`
on Android):

```js
localStorage.setItem("ANTHROPIC_API_KEY", "sk-ant-...");
```

A proper in-app settings panel is on the list.

## Style dictionary

The desktop-app icon (the multi-colored globe mark) is rendered from
`src/renderer/tokens/rainbow-web.json` — a JSON design dictionary.
The renderer fetches it via `src/renderer/lib/rainbow-web.js`, which
exposes `window.tinkerLogo.buildRainbowWebSvg()` for any consumer
that wants the mark as an SVG string.

## What's inside

```
web/
├── src/
│   ├── main/
│   │   ├── main.js         # Electron main process — window, session, IPC
│   │   └── preload.js      # contextBridge exposing the `tinker` API
│   └── renderer/
│       ├── index.html      # Browser chrome shell
│       ├── styles.css      # Brand styling
│       └── renderer.js     # Tabs, address bar, navigation
└── package.json
```

The renderer is plain HTML/CSS/JS — no build step, no bundler. Each
tab maps to either the welcome page (in-DOM) or an Electron
`<webview>` mounted lazily on first navigation.

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
