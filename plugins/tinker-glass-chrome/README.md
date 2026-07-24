# tinker-glass-chrome

Native iOS **Liquid Glass** chrome overlay for tinker.

Mounts SwiftUI controls above the Capacitor WebView using Apple’s
`glassEffect` (iOS 26+) so the floating navigation layer matches system
chrome. Pre-iOS 26 falls back to `.ultraThinMaterial`.

## What it draws

| Control | Position | Glass shape |
|---|---|---|
| Drawer toggle | Top-leading, safe-area aware | Circle |
| AI / No AI mode nav | Bottom-center (welcome only) | Capsule |

Content stays in the WebView. Glass stays on the navigation layer — per
[Apple’s Liquid Glass guidance](https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass).

## Requirements

- Xcode 26+ (iOS 26 SDK) for true Liquid Glass
- Capacitor iOS project (`npx cap add ios` on macOS)
- iOS 15+ deployment target (material fallback on OS &lt; 26)

## Wire-up (after `cap add ios`)

From the repo root on a Mac:

```bash
npm install
npm run mobile:add:ios    # once
npm run mobile:sync
npm run mobile:open:ios
```

`cap sync` registers this local plugin via the `file:plugins/tinker-glass-chrome`
dependency. The renderer calls `GlassChrome.present()` on iOS and hides the
CSS glass chips while the native overlay is live.

## Plugin API

- `isAvailable()` → `{ available, liquidGlass }`
- `present()` / `dismiss()`
- `setModeNav({ mode: 'ai'|'noai', offline, visible })`
- `setDrawerToggle({ expanded, visible })`
- Events: `drawerToggle`, `modeSelect`
