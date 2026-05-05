# tinker-browser UI kit

A high-fidelity React recreation of tinker's chrome — sidebar,
welcome page, search-results pane, and supporting bits — pulled from
the production renderer at `src/renderer/`.

## Files

- `index.html` — full interactive shell. Open it and you can create
  sessions, type a query, watch the loading state, and see the
  search-essay pane.
- `Logo.jsx` — the rainbow-web mark, hand-rolled to match the JSON
  dictionary in `assets/rainbow-web.json`.
- `Sidebar.jsx` — left rail: brand block, nav buttons, "New session",
  Sessions list, footer.
- `Session.jsx` — a single session row (selected / hover / loading).
- `WelcomePage.jsx` — `A new way to web` title + the pill search field.
- `SearchPane.jsx` — search-result pane in its three states (loading,
  ready, error).

The interactions are mocked — there's no real Anthropic call, no
webview. The renderer logic is the same shape as production, just
without IPC.
