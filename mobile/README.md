# tinker — native iOS (Expo)

Native React Native app for tinker. **Expo / EAS is the release manager**
for iOS: builds, OTA updates, and App Store submit all go through EAS.

The shell ships Liquid Glass chrome and the core writing surfaces. Product
API traffic hits the same Vercel deploy as the web app
(`https://tinker.beginner.work`).

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
| `/connect-repo` | GitHub PAT + repo before writing |

## Local develop

```bash
cd mobile
npm install
npm start          # Expo Dev Client + Metro on localhost
```

From the repo root: `npm run expo:start` / `npm run expo:ios`.

Do not paste an `expo.dev/builds/...` URL into the client — that returns
HTML and redboxes with a MIME error. Use Metro (`npm start`) or an
embedded `simulator` profile build.

## EAS profiles (release manager)

| Profile | What | Metro? |
|---|---|---|
| `simulator` | Embedded JS for iOS Simulator | No |
| `development` | Dev client for Simulator | Yes |
| `development-device` | Physical iPhone (Apple creds) | Yes |
| `preview` | Internal distribution | No |
| `production` | App Store binary + `production` channel | No |

### Cut an iOS release

```bash
# From repo root — build + auto-submit to App Store Connect
npm run expo:release:ios

# Or stepwise:
npm run expo:build:ios      # EAS production build
npm run expo:submit:ios     # submit latest iOS binary
npm run expo:publish:production   # OTA JS update on production channel
```

Requires `eas-cli` login (or `EXPO_TOKEN` in CI) and Apple credentials
linked to the Expo project
[tlindows-organization / tinker](https://expo.dev/accounts/tlindows-organization/projects/tinker).

### Simulator smoke build

```bash
npm run expo:build:simulator
# on a Mac with Simulator:
cd mobile && npm run run:ios:sim
```

## Config

| Key | Value |
|---|---|
| Bundle id | `co.tinker.expo` |
| EAS project | `76dac9bb-b869-4c67-a318-cb3e89d1fcf3` |
| API base | `https://tinker.beginner.work` (`EXPO_PUBLIC_API_BASE`) |
| Updates | `https://u.expo.dev/76dac9bb-b869-4c67-a318-cb3e89d1fcf3` |

## Still on web / Electron

Full pitch tree lighting, wallet WebView, email composer, receipts
redesign, voice-model RULE 10, membership checkout, MCP connector UI.
