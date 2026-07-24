# iOS Liquid Glass chrome overlay

## Goal

Use Apple’s native Liquid Glass for tinker’s floating navigation chrome
on iOS, without rewriting the product UI out of the Capacitor WebView.

## Architecture

```
┌─────────────────────────────────────────┐
│  SwiftUI GlassChrome overlay            │
│   • drawer toggle (circle glass)        │
│   • AI / No AI mode nav (capsule glass) │
├─────────────────────────────────────────┤
│  Capacitor WKWebView (src/renderer)     │
│   • content, sidebar, writing, feeds    │
│   • CSS chrome hidden when overlay live │
└─────────────────────────────────────────┘
```

Apple’s guidance: Liquid Glass belongs on the **navigation layer** that
floats above content — not on content cards themselves. This overlay
covers exactly the controls that already used CSS glass.

## Pieces

| Path | Role |
|---|---|
| `plugins/tinker-glass-chrome/` | Local Capacitor plugin (SwiftUI + Android stub) |
| `src/renderer/native-glass-chrome.js` | Detects iOS plugin, presents overlay, syncs state, hides CSS |
| `src/renderer/mobile-drawer.css` | `html.native-glass-chrome` hides CSS drawer toggle + mode-nav |

## Setup (Mac + Xcode 26)

```bash
npm install
npm run mobile:add:ios   # once
npm run mobile:sync
npm run mobile:open:ios  # build & run on iOS 26 simulator/device
```

`cap sync` links `tinker-glass-chrome` from `package.json`
(`file:plugins/tinker-glass-chrome`).

## Behaviour

1. On Capacitor iOS, `GlassChrome.isAvailable()` returns `{ available: true, liquidGlass: true|false }`.
2. `present()` mounts the SwiftUI host above the bridge view controller.
3. `html.native-glass-chrome` is set; CSS chips are `display: none`.
4. Mode / drawer / welcome visibility sync from the DOM to native.
5. Native taps emit `drawerToggle` / `modeSelect`; the bridge clicks `#drawer-toggle` / `#mode-ai` / `#mode-noai` so `mobile-drawer.js` and `freewrite.js` keep owning logic.

## Out of scope (for now)

- Sidebar / sheets / modals / toasts as native glass
- Android Material equivalents
- Electron desktop chrome

Those can extend the same plugin later without moving content out of the WebView.
