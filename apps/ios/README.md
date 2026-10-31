# Tinker iOS (Milestone 1)

Expo SDK 58 (New Architecture on by default) + Expo Router + TypeScript.
Talks to the existing Tinker backend at `https://tinker.beginner.work`.

## What works in M1

- Paste or share-in a public URL to expert text (docs, README, talk transcript, …)
- Read aloud via `/api/reading` TTS (non-Tyler voice; never `JlYdFGRHWwlz51Zh5K2n`)
- Interrupt by typed or spoken question; grounded answer + resume
- Word-tracking cursor UI while a chunk plays
- Metrics: `session_start` / `question_asked` with `platform=ios`, anonymous `ra_…` device id, and `site_domain` (hostname only)
- Share sheet receive via `expo-share-intent` (“Read with Tinker” activation)
- `eas.json` ready for TestFlight (Apple Developer enrollment pending — do not submit yet)

Product framing: help people engage with text written by domain experts — a
customer stuck on docs, an engineer in a dense codebase, a newcomer hearing a
talk for the first time. Not target-company article reading.

## Milestone 2 (doc only)

See [`docs/MILESTONE_2_SAFARI_EXTENSION.md`](./docs/MILESTONE_2_SAFARI_EXTENSION.md).

## Develop

```bash
cd apps/ios
npm install
npx expo start
```

Expo web is useful for UI screenshots when an iOS simulator is unavailable.

```bash
npx expo start --web
```

## EAS / TestFlight

1. Set `EAS_PROJECT_ID` (and optional `EAS_OWNER`) or edit `app.config.ts` `extra.eas.projectId`.
2. `npx eas-cli login` then `npx eas-cli build --platform ios --profile production`.
3. After Apple Developer enrollment + App Store Connect app id: fill `submit.production.ios` in `eas.json`, then `npx eas-cli submit --platform ios` (not attempted in this PR).

Env:

- `EXPO_PUBLIC_API_BASE_URL` — defaults to `https://tinker.beginner.work`

## Voice

On-device speech recognition (`expo-speech-recognition`) for interrupt questions.
TTS always comes from the Tinker backend (ElevenLabs). If Production
`ELEVENLABS_API_KEY` lacks `text_to_speech`, speak/ask will 503 — that is a
deploy blocker, not an app bug.
