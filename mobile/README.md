# tinker — Expo Go / Simulator preview

React Native / Expo shell so **native Liquid Glass** can be opened on an
**iPhone 17 Pro simulator**. Not a full Capacitor port — welcome + glass chrome.

## Fix: `Expected MIME-Type … got 'text/html'`

That redbox means the simulator requested a **JS bundle** and got an **HTML
page** instead. Almost always one of:

1. Metro isn’t running (or was started from the wrong folder)
2. The dev client opened an **expo.dev / EAS download URL** instead of Metro
3. The client is pointed at a host that serves HTML (wrong IP / stale URL)

### Fast path — embedded simulator build (no Metro)

Install a build that **bundles JS inside the .app** so it launches without a
dev server:

```bash
cd mobile
npm run build:simulator
# then on your Mac:
xcrun simctl boot "iPhone 17 Pro" 2>/dev/null || true
open -a Simulator
npx eas-cli build:run -p ios --latest
```

### Dev-client path (live reload)

```bash
cd mobile          # must be this folder, not the repo root
npm install
npm start          # = expo start --dev-client --localhost
```

In the installed **development** client on the iPhone 17 Pro simulator:

- Use **Fetch development servers** / open the `localhost` entry, **or**
- Press `i` in the Metro terminal to open the simulator

Do **not** paste an `https://expo.dev/.../builds/...` link into the client —
that page is HTML and triggers the MIME error.

Reload with `⌘R` after Metro is up.

## Profiles

| Profile | What it is | Needs Metro? |
|---|---|---|
| `simulator` | iOS Simulator `.app` with embedded JS | No |
| `development` | Dev client for iPhone 17 Pro Simulator | Yes (`npm start`) |
| `development-device` | Physical iPhone (needs Apple creds) | Yes |

```bash
npm run build:simulator   # recommended for a quick 17 Pro sim smoke test
npm run build:dev:ios     # live-reload dev client
```

Builds use EAS `image: latest` (Xcode 26.x / iPhone 17 Pro runtime).

## Latest artifacts

| Platform | Link |
|---|---|
| **iOS Simulator (embedded JS — use this)** | [EAS](https://expo.dev/accounts/tlindows-organization/projects/tinker/builds/3278d695-9d30-4087-aeb2-46f5d87bc422) · [download](https://expo.dev/artifacts/eas/ZyGODIEVYYdnveHouktf2DGwC4MrINtwSxlL9PH_lns.tar.gz) |
| Android APK | [EAS](https://expo.dev/accounts/tlindows-organization/projects/tinker/builds/b57a49b8-b13f-4459-9b6d-b02af5482fe2) |
| iOS Simulator (dev client) | [EAS](https://expo.dev/accounts/tlindows-organization/projects/tinker/builds/fd487703-64cb-4b8a-b56b-23bf433476e3) |
| Prior sim build | [EAS](https://expo.dev/accounts/tlindows-organization/projects/tinker/builds/35ca9652-a960-46c5-b537-36186bdc9e56) |

## Expo Cloud

| Surface | URL |
|---|---|
| Project | https://expo.dev/accounts/tlindows-organization/projects/tinker |
| EAS Update (preview) | https://expo.dev/accounts/tlindows-organization/projects/tinker/updates/bc83e9fb-157a-485d-beca-cef92f971937 |
| Web hosting | https://tinker--3dfoe3snxo.expo.app |

```bash
npm run publish:preview
npm run deploy:web
```

## Scope

| In this preview | Still in Capacitor / web |
|---|---|
| Welcome + glass chrome/cards/drawer | Auth, writing, pitches, wallet, sync |
