# Style dictionary

Vendored copy of the design tokens that originate in
[beginner-work/beginner](https://github.com/beginner-work/beginner)
under `ui/src/tokens/`. Treat the beginner repo's copy as the
source of truth — when you edit anything here, update the upstream
file in the same change set.

```
beginner-work/beginner   ui/src/tokens/<name>.json   ← canonical
beginner-work/web        src/renderer/tokens/<name>.json   ← vendored
```

Living inside `src/renderer/` means these files travel with both
the Electron renderer and the Capacitor `webDir`, so the same
fetch path works on desktop and mobile.

## Files

| File | What it describes |
|---|---|
| `rainbow-globe.json` | The pastel rainbow globe mark used as the desktop browser's app icon. |

For the schema, see the upstream README in the beginner repo.
