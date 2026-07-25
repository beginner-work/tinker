# tinker — native Expo app

React Native / Expo shell for **Liquid Glass** chrome and the core tinker
surfaces on an **iPhone 17 Pro simulator**.

## Screens

| Route | Surface |
|---|---|
| `/` | Welcome + place grid (glass cards) |
| `/sign-in` | Phone → PIN (Stytch) |
| `/write` | AI interview (founder-only stitch) |
| `/freewrite` | No AI freewrite → publish |
| `/assessing` | Post-publish confirmation |
| `/essays` | Essay list |
| `/read` | Read an essay |
| `/pitch-script` | Eleven pitch headings |
| `/founders` | Find my founders (adjacency) |
| `/profile` | Account + wallet / Back me links |

Floating **drawer toggle** + **AI / No AI** mode nav use native Liquid Glass
via `expo-glass-effect` when available.

## Fix: `Expected MIME-Type … got 'text/html'`

That redbox means the simulator got HTML instead of a JS bundle.

**Embedded simulator build (no Metro):**

```bash
cd mobile
npm run build:simulator
xcrun simctl boot "iPhone 17 Pro" 2>/dev/null || true
open -a Simulator
npx eas-cli build:run -p ios --latest
```

**Dev client + Metro:**

```bash
cd mobile
npm start          # --dev-client --localhost
```

Do not paste an `expo.dev/builds/...` URL into the client.

## Profiles

| Profile | What | Metro? |
|---|---|---|
| `simulator` | Embedded JS for iOS Simulator | No |
| `development` | Dev client for Simulator | Yes |
| `development-device` | Physical iPhone (Apple creds) | Yes |

## Latest artifacts

| Platform | Link |
|---|---|
| **iOS Simulator (embedded JS — screens)** | [EAS](https://expo.dev/accounts/tlindows-organization/projects/tinker/builds/8623e47e-d7ee-49b9-be70-2a3f8df64d9d) · [download](https://expo.dev/artifacts/eas/ktF16RhiGwRdAyRmwbUvNEn2aU_RvaV5vQBt6QWOR_0.tar.gz) |
| Android APK | [EAS](https://expo.dev/accounts/tlindows-organization/projects/tinker/builds/b57a49b8-b13f-4459-9b6d-b02af5482fe2) |
| Prior embedded sim | [EAS](https://expo.dev/accounts/tlindows-organization/projects/tinker/builds/3278d695-9d30-4087-aeb2-46f5d87bc422) |
| iOS Simulator (dev client) | [EAS](https://expo.dev/accounts/tlindows-organization/projects/tinker/builds/fd487703-64cb-4b8a-b56b-23bf433476e3) |

## Expo Cloud

| Surface | URL |
|---|---|
| Project | https://expo.dev/accounts/tlindows-organization/projects/tinker |
| Web hosting | https://tinker--3dfoe3snxo.expo.app |

API base: `https://tinker-theta.vercel.app` (override with `EXPO_PUBLIC_API_BASE`).

## Still on web / Capacitor

Full pitch tree lighting, wallet WebView, email composer, receipts redesign,
voice-model RULE 10, membership checkout.
