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

```bash
npm install
export TINKER_API_BASE="http://localhost:4000"   # the beginner API base
npm run web                                      # serves http://localhost:5173
```

The web build doesn't ask for an Anthropic key. Instead it gates the app
behind a phone/PIN sign-in: enter your phone, receive a 6-digit code,
verify it. Sign-up and login share the same screen — if it's your first
time, an account is created automatically.

The flow is:

1. The browser POSTs `/api/auth/phone/request` with the phone number.
2. The web host (`src/web/server.js`) forwards it to the beginner API at
   `${TINKER_API_BASE}/claude/auth/phone/request`. The API stores a 6-digit
   PIN and (in dev) returns it in the response so it can be displayed.
3. The browser POSTs `/api/auth/phone/verify` with `{ phone, pin }`. The
   API issues a JWT scoped to a `ClaudeUser`. The browser stores it under
   `tinker_jwt` in `localStorage`.
4. Subsequent searches POST `/api/search` with the JWT; the host proxies to
   the beginner API's `/claude/chat`, which streams from Anthropic on the
   server side. The browser bundle never sees an Anthropic key.

Sign out by clearing `tinker_jwt` (`window.tinkerAuth.signOut()` from the
inspector, or `localStorage.removeItem("tinker_jwt")`).

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
