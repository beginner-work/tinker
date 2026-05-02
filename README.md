# tinker

tinker — a quiet place to be on the web.

A minimal desktop browser built on Electron. The chrome wears tinker's
multi-colored globe mark on a warm cream background, with Plus Jakarta
Sans for display and Inter for body.

## Run it

```bash
npm install
export ANTHROPIC_API_KEY="sk-ant-..."   # required for the in-browser search
npm start
```

Use `npm run dev` to open with DevTools attached.

## Search

The address-bar / welcome-page search uses Claude Haiku 4.5 instead of
a third-party engine. Queries are answered as short essays — three to
five paragraphs of plain prose with embedded links to real sites you
can click through to. The Anthropic system prompt is marked for prompt
caching, so repeat queries skip the cold-start cost.

If `ANTHROPIC_API_KEY` isn't set, the search pane shows a friendly
error explaining how to fix it.

## Claude chat

Click **Claude chat** in the sidebar to open the chat client. It signs
in against the [`beginner-work/beginner`](https://github.com/beginner-work/beginner)
backend (the `/claude/auth/*` endpoints) and proxies streaming chat
through `/claude/chat`, so users never need their own Anthropic key —
the central tinker key is enforced server-side with per-user daily
token quotas.

### Backend URL resolution

The chat window resolves its backend URL once at launch, in this order:

1. `BACKEND_URL` env var — explicit override (any environment)
2. dev / unpackaged build → `http://localhost:4000`
3. `TINKER_USE_VERCEL_PREVIEW=1` + `VERCEL_TOKEN` + `VERCEL_PROJECT_ID`
   → newest READY preview deployment from the Vercel API
4. production → `https://beginner.work`

The current backend is shown at the bottom of the auth card so you can
spot misconfigured environments at a glance.

### CORS

The backend mounts `cors()` wide-open. Electron renderer pages run on a
`file://` origin, which some servers reject in CORS preflight; the
main process sidesteps that by rewriting the `Origin` header on
backend-bound requests via `webRequest.onBeforeSendHeaders` to a stable
allow-listed origin (`https://tinker.beginner.work`). With both pieces
in place, fetch + SSE work uniformly across dev, preview, and packaged
builds.

### JWT storage

The 7-day JWT returned by `/claude/auth/login` is encrypted with
Electron's `safeStorage` (OS keychain — Keychain on mac, DPAPI on
Windows, libsecret on Linux) and written 0600 to
`<userData>/claude-token.bin`. If the platform can't encrypt, we
refuse to persist — better in-memory-only than plaintext on disk.

The renderer never sees the raw file. All access goes through three
narrow IPC channels exposed in `preload-chat.js`:

```ts
window.api.getToken(): Promise<string | null>
window.api.setToken(token: string): Promise<boolean>
window.api.clearToken(): Promise<boolean>
window.api.getBackendUrl(): Promise<string>
```

The chat client decodes the JWT only to read `exp` (to skip login on
restart). Identity is always re-verified by the backend.

### SSE streaming

The chat client uses `fetch()` + a manual `text/event-stream` parser
over `response.body` — `EventSource` can't carry a custom
`Authorization` header. `content_block_delta` events with
`delta.type === "text_delta"` are appended to the assistant bubble
token-by-token. `thinking_delta` events are ignored (TODO: optional
"thinking" pane). Mid-stream `event: error` payloads surface inline
via the chat banner.

Status branching:

- 200 → SSE stream
- 401 → clear token, route to login
- 429 → "Daily limit reached, resets at <retry_at>" inline
- 503 → "Server misconfigured — contact admin"

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

The Claude chat window is Electron-only — the **Claude chat** button is
hidden when `window.tinker.openChat` isn't on the bridge.

### How the platforms differ

| | Electron desktop | Capacitor mobile / web |
|---|---|---|
| Tabs / sessions | Yes — left sidebar | Yes (collapsed rail on phones) |
| In-app browsing | Native `<webview>` | External — opens in iOS/Android system browser via `@capacitor/browser` |
| Search engine | IPC → main process → Anthropic SDK | Direct browser-side fetch with prompt caching |
| Claude chat | Yes — separate window | Not yet (TODO) |
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

## Build

```bash
npm run build           # current platform
npm run build:mac       # .dmg for x64 + arm64
npm run build:win       # .exe (NSIS)
npm run build:linux     # AppImage
```

Code signing / notarization is intentionally unconfigured (TODO —
wire `CSC_LINK` / `CSC_KEY_PASSWORD` for mac and `certificateFile` /
`certificatePassword` for win). The output goes to `dist/`.

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
│   │   ├── main.js              # Electron main — windows, IPC, safeStorage
│   │   ├── preload.js           # browser preload (window.tinker)
│   │   └── preload-chat.js      # chat-window preload (window.api)
│   └── renderer/
│       ├── index.html           # browser chrome shell
│       ├── styles.css
│       ├── renderer.js          # tabs, address bar, navigation
│       └── chat/
│           ├── index.html       # chat shell with login/signup/chat screens
│           ├── chat.css
│           ├── app.js           # entry + screen routing
│           ├── api.js           # backend URL + SSE reader
│           ├── jwt.js           # decode + isExpired
│           ├── login.js
│           ├── signup.js
│           └── chat-screen.js   # thread + composer + conversation list
├── electron-builder.yml
└── package.json
```

The renderer is plain HTML/CSS/JS — no build step, no bundler. Each
tab maps to either the welcome page (in-DOM) or an Electron
`<webview>` mounted lazily on first navigation. The chat client lives
in its own window for clean isolation: separate preload, separate
CSP, separate state.

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

## Out of scope (chat client, v1)

- Model picker (backend accepts `model?` but no UI)
- File attachments / vision
- Conversation persistence (backend is stateless; client keeps history
  in-memory only)
- "Thinking" rendering (`thinking_delta` events are dropped)
- Settings UI
- Auto-update
- Code signing / notarization
- Phone-OTP / SMS code login via SendBlue (the existing
  `/claude/auth/*` endpoints are email + password; switching to text
  codes requires a new backend route + ClaudeUser schema change —
  flagged as TODO)
