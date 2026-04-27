# Style dictionary

Design tokens for the tinker browser's brand marks. Each file
describes a single mark; the renderer reads it via
`src/renderer/lib/<name>.js` to build the SVG.

Living inside `src/renderer/` means these files travel with both
the Electron renderer and the Capacitor `webDir`, so the same
fetch path works on desktop and mobile.

## Files

| File | What it describes |
|---|---|
| `rainbow-web.json` | The multi-colored globe used as tinker's app icon. |
