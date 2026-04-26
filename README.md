# web

beginner's web browser — a quiet place to be on the web.

A minimal desktop browser built on Electron. The chrome adopts the
[beginner brand language](https://github.com/beginner-work/beginner/blob/main/BRAND.md)
from the main repo: warm cream background, forest-green seed mark,
Plus Jakarta Sans for display, Inter for body.

## Run it

```bash
npm install
export ANTHROPIC_API_KEY="sk-ant-..."   # required for search
npm start
```

Use `npm run dev` to open with DevTools attached.

## Search

The address-bar / welcome-page search uses Claude Haiku 4.5 instead of
a third-party engine. Queries are answered as short essays — three to
five paragraphs of plain prose with embedded links to real sites you
can click through to. The Anthropic system prompt is marked for prompt
caching, so repeat queries skip the cold-start cost.

If `ANTHROPIC_API_KEY` isn't set, the search pane shows a friendly
error explaining how to fix it.

## Plugins

The welcome bar has a small mode toggle that switches between plugins.
Each plugin owns its placeholder, button label, and submit handler;
adding a new one is one entry in `src/renderer/renderer.js` plus a
matching tab in `index.html`.

### LinkedIn post

Switch the welcome toggle to **Post to LinkedIn**, type what's on your
mind, and hit **Post**. The post is published with the line

> — made by me, supported by beginner

appended on its own paragraph. Requires:

```bash
export LINKEDIN_ACCESS_TOKEN="..."     # OAuth token with w_member_social
export LINKEDIN_AUTHOR_URN="urn:li:person:abc123"
```

The token is sent only to LinkedIn's API; nothing is written to disk.

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
queries (anything else falls through to Google).
