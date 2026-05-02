# tinker chat

Desktop Claude chat client built on **electron-vite + React + TypeScript +
Tailwind**. Talks to the shared-key backend over HTTPS — JWT in
`Authorization`, streaming `/claude/chat` responses parsed as SSE.

The renderer is sandboxed with context isolation on and Node integration
off. The only IPC surface is `window.api` for token storage (encrypted
via Electron's `safeStorage`, which uses the OS keychain) and the backend
URL.

## Run it

```bash
cd desktop
npm install
export BACKEND_URL="http://localhost:4000"   # default if unset
npm run dev
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
        │   ├── api.ts       signup, login, streamChat (SSE)
        │   ├── jwt.ts       decode-only `exp` check
        │   └── storage.ts   window.api wrapper
        └── screens/         Login, Signup, Chat
```

### Auth & storage

JWT is encrypted with `safeStorage.encryptString` and written to
`<userData>/auth.bin`. On launch we decrypt, decode the `exp`, and skip
to **Chat** if it's still valid. Anything else routes to **Login**. The
client only reads `exp` from the payload — it never trusts the contents
of the JWT.

### SSE streaming

`streamChat` uses `fetch()` (not `EventSource` — `EventSource` can't send
custom `Authorization` headers). It branches on response status:

- **200** → reads `response.body` as a stream, splits on `\n\n`, parses
  each `event: <type>\ndata: <json>` block, and:
  - emits `delta.text` from `content_block_delta` where
    `delta.type === "text_delta"`
  - emits `delta.thinking` (rendered in a collapsible "thinking" area)
    from `thinking_delta`
  - surfaces mid-stream `event: error\ndata: { message }` inline
- **401** → clears the token and routes back to Login
- **429** → shows "Daily limit reached, resets at &lt;local time&gt;"
- **503** → shows "Server misconfigured — contact admin."
- **400** → shows the error message inline

### What's intentionally missing

- **Persistence.** Conversations live in renderer state only — they
  vanish on quit. The backend is fully stateless (every request sends
  the full history), so persistence is purely a client concern. Marked
  with `TODO(persistence)` in `src/renderer/src/screens/Chat.tsx`.
- **Model picker, file attachments, settings, auto-update.** Out of
  scope for v1.
