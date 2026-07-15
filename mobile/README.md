# tinker mobile

The native tinker app — Expo / React Native. Replaces the Capacitor
WebView shell for iOS and Android; the web renderer and Electron desktop
app are untouched. Full plan and decision record:
[`docs/expo-migration.md`](../docs/expo-migration.md).

What it does today: phone/PIN sign-in against the production Stytch
flow, the guided writing interview (same prompt + founder-only stitch
guarantee as the web renderer, publish-through to the shared
`TinkerUserData` store), voice dictation with on-device speech
recognition, and an assistant layer that runs interview turns on Gemini
Nano (supported Android devices) with the `/api/claude/converse` proxy
as the universal fallback.

## Run

```bash
npm install
npm run typecheck
npx expo prebuild      # generates ios/ + android/ (git-ignored)
npx expo run:ios       # or npx expo run:android
```

**Expo Go won't work** — the app includes native modules
(`expo-speech-recognition`, the local `modules/gemini-nano`), so use a
development build (`expo run:*` locally or an EAS `development` build).

Backend override: `EXPO_PUBLIC_API_BASE=https://…` (defaults to the
production deployment set in `app.json` → `extra.apiBase`).

## Layout

- `app/` — expo-router screens (`sign-in`, `home`, `write`)
- `src/theme.ts` — design tokens ported from `src/renderer/` (keep in sync)
- `src/api/` — client for the Vercel `/api/*` functions
- `src/lib/interview.ts` — the writing-flow engine (keep prompt in sync
  with `src/renderer/writing.js`)
- `src/lib/assistant.ts` — Gemini Nano ⇄ Claude provider switch
- `modules/gemini-nano/` — local Expo module over ML Kit's GenAI Prompt
  API (Android; beta artifact — see the note in its `build.gradle`)
