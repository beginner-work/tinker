# tinker — Expo Go preview

React Native / Expo shell so **native Liquid Glass** can be opened in
**Expo Go** on an iOS 26 device. This is not a full port of the Capacitor
product yet — welcome surface + glass chrome.

## What you get

- Paper welcome screen (Fraunces + Instrument Sans) with atmospheric color so glass has something to refract
- **Glass place cards** grouped via `GlassContainer` (morph on iOS 26+)
- Floating **drawer toggle** and **AI / No AI** mode nav on `GlassView`
- Glass **sidebar sheet**
- Runtime guards: `isLiquidGlassAvailable`, `isGlassEffectAPIAvailable`, and Reduce Transparency
- Frosted cream fallback on Android, web, older iOS, and a11y-limited devices

## Development build (recommended for Liquid Glass)

Expo Go is enough for a quick look, but a **dev client** ships the native
`expo-glass-effect` binary in your own build:

```bash
cd mobile
npm run build:dev            # iOS simulator + Android APK (EAS cloud)
# npm run build:dev:device   # iOS device — needs Apple creds on the Expo account
```

Install the artifact from the EAS dashboard / QR, then:

```bash
npx expo start --dev-client
```

Profiles live in `eas.json` (`development`, `development-device`).


## Publish to Expo Cloud (review links)

Needs Cursor secret `EXPO_TOKEN` (Expo robot access token).

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

### Live links (this branch)

| Surface | URL |
|---|---|
| Expo project | https://expo.dev/accounts/tlindows-organization/projects/tinker |
| EAS Update (preview, Expo Go SDK 57) | https://expo.dev/accounts/tlindows-organization/projects/tinker/updates/bc83e9fb-157a-485d-beca-cef92f971937 |
| Web hosting preview | https://tinker--3dfoe3snxo.expo.app |

After publish, open the update on [expo.dev](https://expo.dev) → project →
**Updates** (or the Hosting URL printed by `eas deploy`).

## Status strip

The bottom status line reports whether Liquid Glass is live (`liquid` /
`api` flags from Expo), plus Reduce Transparency. Use that to confirm the
device is on the right OS.

## Scope

| In this preview | Still in Capacitor / web |
|---|---|
| Welcome + glass chrome/cards/drawer | Auth, writing, pitches, wallet, sync |

The Capacitor Liquid Glass plugin (`plugins/tinker-glass-chrome`) remains the
path for the production iOS shell.
