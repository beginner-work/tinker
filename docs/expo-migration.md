# Expo native app — migration plan

tinker is moving from a WebView shell (Capacitor wrapping `src/renderer/`)
to a **real native app** built with Expo / React Native. The web renderer,
Electron desktop app, and every Vercel serverless function stay exactly as
they are — this migration replaces only the *mobile* client.

The foundation lives in [`mobile/`](../mobile/). This document is the map
for finishing the move.

## Why Expo (decision record)

- **Native feel now.** The founder-facing surface is a writing app; WebView
  keyboard/scroll behavior on iOS is its weakest point. React Native gives
  native text input, scrolling, and gestures.
- **Web-like release cadence.** EAS Update ships JS/asset changes
  over-the-air in minutes. Only native changes (new modules, permissions,
  SDK upgrades) go through store review. Since all of tinker's product
  logic is JS talking to the existing `/api/*` functions, day-to-day
  iteration stays `git push`-shaped.
- **On-device AI.** The move unlocks Google's on-device models:
  speech recognition for dictation (both platforms) and Gemini Nano via
  ML Kit's GenAI Prompt API (supported Android devices), with the
  existing Claude proxy as the always-available fallback.

## What does NOT change

- Every Vercel function under `api/` — auth, converse, user-data, voice,
  pitches, publish. The mobile app is just another Bearer-token client.
- The Stytch phone/PIN flow and session tokens (stored in SecureStore
  instead of localStorage).
- The `TinkerUserData` row store and its whole-array blob semantics.
  Mobile writes the same draft/essay shapes (`d_*`/`e_*` ids,
  `mergeById` semantics) so rows interleave cleanly with web/desktop.
- The web renderer (`src/renderer/`) for browser + PWA, and Electron
  (`src/main/`) for desktop.

## What is in the foundation (this PR)

| Piece | File(s) | Status |
|-------|---------|--------|
| Expo SDK 57 + expo-router app shell | `mobile/app/` | ✅ builds (tsc + Metro export) |
| Design tokens ported (colors/type/radii, Fraunces + Instrument Sans) | `mobile/src/theme.ts` | ✅ |
| API client, SecureStore token, 401 handling | `mobile/src/api/client.ts` | ✅ |
| Phone → PIN sign-in | `mobile/app/sign-in.tsx` | ✅ |
| Home: start writing + drafts list (server-synced) | `mobile/app/home.tsx` | ✅ |
| Writing flow: interview engine ported (RULES 1–7, strict JSON, founder-only stitch verify, publish-through) | `mobile/src/lib/interview.ts`, `mobile/app/write.tsx` | ✅ |
| Dictation, on-device first | `mobile/src/lib/useDictation.ts` (expo-speech-recognition) | ✅ code; needs device test |
| Gemini Nano local Expo module (Android, ML Kit GenAI Prompt API) | `mobile/modules/gemini-nano/` | ✅ scaffold; needs device build to validate |
| Assistant abstraction: Nano-when-available → Claude proxy | `mobile/src/lib/assistant.ts` | ✅ |

**Not yet ported** (the web renderer keeps serving these): seeds/heatmap,
pitches, feed/read view, profile, wallet/transactions, notifications,
voice-model phrasing (RULE 10), transactions mirror (RULE 8),
pitch-territory steering (RULE 9), membership, email composer, share.

## On-device AI

### Transcription (both platforms)

[`expo-speech-recognition`](https://github.com/jamsch/expo-speech-recognition)
wraps Android's `SpeechRecognizer` (Google's on-device models) and iOS
`SFSpeechRecognizer`. `useDictation` requests
`requiresOnDeviceRecognition: true` first and retries once without it if
the offline model isn't present, so dictation always works. Android can
pre-fetch the offline model via `androidTriggerOfflineModelDownload` —
worth wiring into onboarding later.

### Conversational model (Android)

`modules/gemini-nano/` is a local Expo module over
[ML Kit's GenAI Prompt API](https://developers.google.com/ml-kit/genai)
(`com.google.mlkit:genai-prompt`, beta). It exposes
`availability() / downloadModel() / generate()` to JS. Reality checks:

- **Android-only**, and only on AICore devices (Pixel 9+, recent Galaxy
  flagships). Everything else reports `unavailable`/`unsupported`.
- The artifact is **beta**; pin/bump the version in
  `modules/gemini-nano/android/build.gradle` against the current docs
  before each release build, and validate symbol names on first compile.
- Nano's context window is small. `assistant.ts` caps on-device input
  (~8k chars) and falls back to Claude rather than truncating the
  founder's words. iOS always uses the Claude proxy.
- The interview's strict-JSON + founder-only verification already guards
  against a weaker model: an unparseable reply degrades to "treat it as
  a question", and a stitched body that fails verification falls back to
  the founder's raw answers.

## Release pipeline (to set up next)

1. Apple Developer ($99/yr) + Google Play ($25 once) accounts.
2. `npx eas init` in `mobile/` (creates the EAS project), commit
   `eas.json` with `development` / `preview` / `production` profiles.
3. `eas build --profile development` → dev clients for both platforms
   (required for the native modules; **Expo Go cannot run this app**).
4. `eas submit` for TestFlight / Play internal testing.
5. `eas update` wired to pushes of `main` for OTA JS releases.
   Policy: JS/assets ship OTA; anything touching `mobile/modules/`,
   `app.json` plugins/permissions, or the Expo SDK version is a new
   binary + store submission (EAS runtime-version fingerprinting
   enforces this automatically).

## Migration phases

1. **Foundation (this PR)** — auth, home, writing flow, dictation,
   assistant abstraction, Nano scaffold.
2. **Validate on device** — dev build, run the interview end-to-end on
   iPhone + an AICore Android device; compile-check the Nano module and
   fix any beta-API drift; store accounts + first TestFlight build.
3. **Read surface** — feed of published essays, read view, pull the
   voice-model phrasing (RULE 10) into mobile turns.
4. **Seeds & pitches** — seed cards, pitch list/read, publish-stories.
5. **Long tail** — profile, wallet/transactions (RULE 8), pitch-territory
   steering (RULE 9), notifications, membership, share sheet.
6. **Retire Capacitor** — remove `capacitor.config.json`, the
   `@capacitor/*` deps, and `mobile:*` npm scripts from the root
   `package.json` once the Expo app is in both stores.

## Running it

```bash
cd mobile
npm install
npm run typecheck        # tsc --noEmit
npx expo export          # Metro bundle smoke test
npx expo prebuild        # generate ios/ + android/ (not committed)
npx expo run:ios         # or run:android — needs Xcode / Android SDK
```

Point the app at a different backend with
`EXPO_PUBLIC_API_BASE=https://…` (defaults to the production Vercel
deployment configured in `app.json` → `extra.apiBase`).
