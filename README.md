# tinker

tinker — a quiet place to be on the web.

A minimal desktop browser built on Electron. The chrome wears tinker's
multi-colored globe mark on a warm cream background, with Plus Jakarta
Sans for display and Inter for body.

## Run it

```bash
npm install
npm start
```

Use `npm run dev` to open with DevTools attached.

The Anthropic API key lives on the server, not on your machine — see
[Search proxy](#search-proxy) below.

## Search

The address-bar / welcome-page search uses Claude Haiku 4.5 instead of
a third-party engine. Queries are answered as short essays — three to
five paragraphs of plain prose with embedded links to real sites you
can click through to. The Anthropic system prompt is marked for prompt
caching, so repeat queries skip the cold-start cost.

## Search proxy

Both the desktop and mobile clients POST `{ query }` to a tiny Vercel
serverless function (`api/search.js`) that holds the Anthropic API key
as a server-side env var. The key is never shipped to the client —
desktop, mobile, and web all hit the same endpoint and get back
`{ text, usage }`.

### Deploying the proxy

The function is deployed to `https://beginner.work/api/search` from the
Vercel project for `beginner.work`. The Anthropic key is stored as the
`ANTHROPIC_API_KEY_WEB` environment variable on that project — `api/search.js`
reads it at request time.

To redeploy or fork:

1. Push this repo to a Vercel project (the function at `api/search.js`
   is auto-detected).
2. In **Settings → Environment Variables**, add `ANTHROPIC_API_KEY_WEB` =
   `sk-ant-…` and redeploy.
3. Update the `DEFAULT_SEARCH_ENDPOINT` constant in `src/main/main.js`
   and `src/renderer/platform-mobile.js` if your domain differs from
   `beginner.work`.

### Pointing at a local proxy during development

Run the function locally with `vercel dev`, then override the endpoint
without editing source:

```bash
# Desktop
TINKER_SEARCH_ENDPOINT="http://localhost:3000/api/search" npm start
```

```js
// Mobile / web — from the WebView inspector
localStorage.setItem("TINKER_SEARCH_ENDPOINT", "http://localhost:3000/api/search");
```

If the proxy is unreachable or the server-side key is missing, the
search pane shows a friendly error explaining where to look.

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
| Search engine | IPC → main process → Vercel proxy | Direct fetch to the same Vercel proxy |
| API key storage | Server-side on Vercel — clients never see it | Server-side on Vercel — clients never see it |

The `src/renderer/platform-mobile.js` shim detects the runtime —
Electron preload short-circuits it; on Capacitor and on the plain
web it polyfills the same `window.tinker.*` surface so the rest
of the renderer code path is identical.

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
