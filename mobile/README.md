# tinker — Expo Go preview

React Native / Expo shell so the **Liquid Glass** navigation chrome can be
opened in **Expo Go** on an iOS 26 device. This is not a full port of the
Capacitor product yet — only the welcome surface + glass chrome.

## What you get

- Paper welcome screen (Fraunces + Instrument Sans, location cards)
- Floating **drawer toggle** and **AI / No AI** mode nav
- Native Liquid Glass via [`expo-glass-effect`](https://docs.expo.dev/versions/v57.0.0/sdk/glass-effect/) when the API is available
- Frosted cream fallback on Android, web, and older iOS

## Run locally in Expo Go

From this folder:

```bash
cd mobile
npm install
npx expo start
```

Scan the QR code with **Expo Go** on your phone.

To see **real** Liquid Glass you need:

- iPhone (or simulator) on **iOS 26+**
- Current Expo Go that includes SDK 57 / `expo-glass-effect`

On anything else the chips still render, using the CSS-like fallback.

## Publish to Expo Cloud (review links)

Needs an Expo account robot token as Cursor secret `EXPO_TOKEN`
([create one](https://expo.dev/settings/access-tokens)). **New secrets only
appear after a fresh Cloud Agent run** (or “Update Existing Env” on the
environment page).

```bash
cd mobile
npx eas-cli whoami                 # should show the robot user
npx eas-cli init --non-interactive # once — links expo.dev project
npx eas-cli update:configure --non-interactive

# Native OTA preview (Expo Go / dev build QR from the dashboard)
npm run publish:preview

# Web review URL on *.expo.app (layout only — no real Liquid Glass)
npm run deploy:web
```

From the repo root: `npm run expo:publish` / `npm run expo:deploy`.

After publish, open the update on [expo.dev](https://expo.dev) → project →
**Updates** (or the Hosting URL printed by `eas deploy`).

## Status strip

The bottom status line reports whether Liquid Glass is live (`liquid` /
`api` flags from Expo). Use that to confirm the device is on the right OS.

## Scope

| In this preview | Still in Capacitor / web |
|---|---|
| Welcome chrome + glass | Auth, writing, pitches, wallet, sync |

The Capacitor Liquid Glass plugin (`plugins/tinker-glass-chrome`) remains the
path for the production iOS shell.
