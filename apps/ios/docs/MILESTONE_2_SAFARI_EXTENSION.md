# Milestone 2 — Safari Web Extension (scoped, not built)

**Status:** Documentation only. Do not implement in Milestone 1.

## Goal

Ship a Safari Web Extension **bundled inside the Tinker iOS app** that overlays
the reading agent on the page the user is already viewing in Safari — so they
do not have to copy/paste a URL into the app.

## Product shape

1. User opens expert text in Safari (docs, README, talk transcript, …).
2. Safari → Share / Extensions → **Tinker**.
3. An overlay (toolbar / content script panel) appears on the page with the same
   Listen / Pause / Ask controls as M1.
4. The extension passes `location.href` to the native app / shared JS that calls
   `https://tinker.beginner.work/api/reading` (same session/speak/ask contract).
5. Word-tracking highlight can optionally inject into the page DOM (M2 stretch);
   M1’s in-app cursor remains the fallback.

## Technical approach (recommended)

| Piece | Choice |
| --- | --- |
| Host | iOS app produced by EAS (`work.beginner.tinker`) |
| Extension type | Safari Web Extension (App Extension target) |
| Tooling | Xcode Safari Web Extension + Expo config plugin, or `xcrun safari-web-extension-converter` on a Manifest V3 folder under `apps/ios/safari-extension/` |
| Messaging | `browser.runtime.sendNativeMessage` / App Groups shared container to hand session ids between extension and RN |
| Auth | Same public-session bootstrap as M1 (`READING_PUBLIC_SESSIONS`); never put `ELEVENLABS_API_KEY` or `TINKER_SERVICE_TOKEN` in the extension |
| Metrics | Continue `platform=ios` + `site_domain` hostname only; optional `embedHost` left empty (Safari page host is `site_domain` / `companyHost`) |

## Why not M1

- Requires a native App Extension target, Apple Developer enrollment, and
  provisioning profiles that are not available while enrollment is pending.
- Content-script CSS injection + New Architecture Expo builds need a dedicated
  config plugin and visual QA on device Safari, which is out of M1 scope.
- M1 already covers share-in of URLs via `expo-share-intent` (“Read with Tinker”
  in the system share sheet), which unblocks TestFlight reading without a
  Safari overlay.

## Acceptance criteria (when building M2)

- [ ] Extension appears in Safari → Manage Extensions on a TestFlight build
- [ ] Overlay starts a reading session for the current tab URL
- [ ] Interrupt ask works without leaving Safari
- [ ] Banned voice id `JlYdFGRHWwlz51Zh5K2n` still refused
- [ ] Owner traffic (`?owner=1`) still excluded from resume metrics
- [ ] No secrets in extension JS
