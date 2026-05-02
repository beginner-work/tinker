# tinker (desktop)

A quiet desktop client built on **electron-vite + React + TypeScript +
Tailwind**. Talks to a backend over HTTPS — JWT in `Authorization`,
streaming responses parsed as Server-Sent Events.

The renderer is sandboxed with context isolation on and Node integration
off. The only IPC surface is `window.api` for token storage (encrypted
via Electron's `safeStorage`, which uses the OS keychain) and the
backend URL.

## Run it

```bash
cd desktop
npm install
npm run dev
```

By default the app talks to **`https://beginner.work`**. Override with
`BACKEND_URL` when developing against a local server:

```bash
BACKEND_URL=http://localhost:4000 npm run dev
```

`npm run dev` opens DevTools alongside the window and serves the renderer
with HMR.

## Build

```bash
npm run package          # both targets your platform supports
npm run package:mac      # .dmg (arm64 + x64)
npm run package:win      # .exe (NSIS)
```

> **TODO:** code signing isn't configured yet. Set `CSC_LINK` /
> `CSC_KEY_PASSWORD` (and on macOS, `hardenedRuntime: true` plus
> notarization) before publishing.

## Architecture

```
src/
├── main/index.ts            window + IPC for token storage
├── preload/index.ts         exposes window.api (4 calls, nothing else)
└── renderer/
    └── src/
        ├── App.tsx          routes Login | Signup | Chat
        ├── lib/
        │   ├── api.ts       signup, login, streaming reply
        │   ├── jwt.ts       decode-only `exp` check
        │   └── storage.ts   window.api wrapper
        └── screens/         Login, Signup, Chat, BrandMark
```

### Auth & storage

JWT is encrypted with `safeStorage.encryptString` and written to
`<userData>/auth.bin`. On launch we decrypt, decode the `exp`, and skip
to the journey screen if it's still valid. Anything else routes to
**Login**. The client only reads `exp` from the payload — it never
trusts the contents of the JWT.

### Streaming replies

The reply API uses `fetch()` (not `EventSource` — `EventSource` can't
send custom `Authorization` headers). It branches on response status:

- **200** → reads `response.body` as a stream, splits on `\n\n`, parses
  each `event: <type>\ndata: <json>` block, emits visible text deltas
  as they arrive, and folds optional reasoning traces into a
  collapsible block.
- **401** → clears the token and routes back to Login
- **429** → shows "Daily limit reached, resets at &lt;local time&gt;"
- **503** → shows "Server misconfigured — contact admin."
- **400** → shows the error message inline

Mid-stream upstream failures arrive as an `event: error` event and
surface inline without crashing the journey.

### What's intentionally missing

- **Persistence.** Journeys live in renderer state only — they vanish
  on quit. The backend is fully stateless (every request sends the full
  history), so persistence is purely a client concern. Marked with
  `TODO(persistence)` in `src/renderer/src/screens/Chat.tsx`.
- **Settings, attachments, auto-update.** Out of scope for v1.
