# tinker — Expo Go preview

React Native / Expo shell so **native Liquid Glass** can be opened in
**Expo Go** or an **iPhone 17 Pro simulator** via a development build.
This is not a full port of the Capacitor product yet — welcome surface +
glass chrome.

## What you get

- Paper welcome screen (Fraunces + Instrument Sans) with atmospheric color so glass has something to refract
- **Glass place cards** grouped via `GlassContainer` (morph on iOS 26+)
- Floating **drawer toggle** and **AI / No AI** mode nav on `GlassView`
- Glass **sidebar sheet**
- Runtime guards: `isLiquidGlassAvailable`, `isGlassEffectAPIAvailable`, and Reduce Transparency
- Frosted cream fallback on Android, web, older iOS, and a11y-limited devices

## Development build — iPhone 17 Pro Simulator

The `development` profile builds an **iOS Simulator** `.app` (no Apple
Developer account required) with Xcode `latest` (SDK 57 / Xcode 26.x),
which includes the **iPhone 17 Pro** simulator runtime.

```bash
cd mobile
npm run build:dev:ios          # EAS cloud → iOS Simulator artifact
```

### Install on iPhone 17 Pro simulator (Mac)

```bash
# Boot the iPhone 17 Pro simulator first (Xcode → Open Developer Tool → Simulator)
xcrun simctl boot "iPhone 17 Pro" 2>/dev/null || true
open -a Simulator

# Download + install the latest simulator build
npx eas-cli build:run -p ios --latest
# or: npm run run:ios:sim
```

Then start Metro against the installed dev client:

```bash
npx expo start --dev-client
```

### Latest simulator builds

| Platform | Status | Install |
|---|---|---|
| Android APK | ✅ finished | [EAS](https://expo.dev/accounts/tlindows-organization/projects/tinker/builds/b57a49b8-b13f-4459-9b6d-b02af5482fe2) · [APK](https://expo.dev/artifacts/eas/y6I40k02tLF4m5peysVmaQXohmpmJ2qgouZ8zteSkGs.apk) |
| iOS Simulator | ✅ finished | [EAS](https://expo.dev/accounts/tlindows-organization/projects/tinker/builds/35ca9652-a960-46c5-b537-36186bdc9e56) · [tar.gz](https://expo.dev/artifacts/eas/3nzReRxgPHEsmfR7OBoWXE4Xa4_O9t21nCPlda6idlk.tar.gz) |

A fresh simulator build pinned to `image: latest` is queued when this
README is updated — check the EAS project builds list for the newest one.

Physical **iPhone** installs need Apple credentials (`npm run build:dev:device`).

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
