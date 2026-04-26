# web

beginner's web browser — a quiet place to be on the web.

A minimal desktop browser built on Electron. The chrome adopts the
[beginner brand language](https://github.com/beginner-work/beginner/blob/main/BRAND.md)
from the main repo: warm cream background, forest-green seed mark,
Plus Jakarta Sans for display, Inter for body.

## Run it

```bash
npm install
npm start
```

Use `npm run dev` to open with DevTools attached.

## What's inside

```
web/
├── src/
│   ├── main/
│   │   ├── main.js         # Electron main process — window, session, IPC
│   │   └── preload.js      # contextBridge exposing the `beginner` API
│   └── renderer/
│       ├── index.html      # Browser chrome shell
│       ├── styles.css      # Brand styling (adopted from beginner/ui)
│       └── renderer.js     # Tabs, address bar, navigation
└── package.json
```

The renderer is plain HTML/CSS/JS — no build step, no bundler. Each
tab maps to either the welcome page (in-DOM) or an Electron
`<webview>` mounted lazily on first navigation.

## Shortcuts

| Action | Shortcut |
|--------|----------|
| New tab | ⌘/Ctrl + T |
| Close tab | ⌘/Ctrl + W |
| Focus address bar | ⌘/Ctrl + L |
| Reload | ⌘/Ctrl + R |
| Close tab (mouse) | Middle-click the tab |

The address bar accepts URLs, hostnames (`beginner.work`), and search
queries (anything else falls through to DuckDuckGo).
