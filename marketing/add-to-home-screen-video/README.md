# Add to Home Screen — video

A HyperFrames (HeyGen) composition that turns tinker's iOS **"Add to Home
Screen"** install slide (the `#pwa-hint-sheet` in `src/renderer/index.html`)
into a 15s vertical (1080×1920) video.

Three beats:

1. **Hero** — the tinker rainbow-globe app icon, `tinker`, *A new way to web*.
2. **Install sheet** — the "Install the app" bottom sheet rising, the app row,
   and the three share-sheet steps staggering in, ending on a highlight of the
   **Add to Home Screen** chip.
3. **Installed** — the icon settling onto a Home Screen, *On your Home Screen*.

## Build

Authored with the local HyperFrames skills (`npx skills add heygen-com/hyperframes`)
because the hosted HeyGen MCP disables `compose`/`render_video` for CLI/IDE
agents. `gsap.min.js` is vendored locally (the jsDelivr CDN is blocked by the
sandbox network policy and external requests fail in offline renders).

```bash
npx hyperframes lint          # 0 errors
npx hyperframes validate      # 0 console errors, WCAG AA pass
npx hyperframes inspect       # 0 layout issues
npx hyperframes render --quality high --output add-to-home-screen.mp4
```
