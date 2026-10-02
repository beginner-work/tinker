# Loop log

Shared handoff between the outer loop (GitHub Copilot coding agent, post-push CI fixes) and the inner loop (Cursor agents, pre-push work). Communicate only through this file and `AGENTS.md`.

Format (one line per entry):

`YYYY-MM-DD | loop | failure type | PR | prevention`

Loops: `outer: Copilot` or `inner: Cursor`. Use `none yet` when a fix landed without a lasting guard.

## Entries

2026-09-30 | outer: Copilot | Playwright E2E file picked up by `npm test` unit glob | #360 | inner: keep E2E as `tests/*.e2e.js`; `npm run check` runs `scripts/check-unit-glob.js`
2026-09-30 | outer: Copilot | Brittle MCP tool-list regex rejected `list_approved_outreach` via substring `approve` | #377 | inner: assert exact tool names (`deepEqual` / exact string), never `/approve/` substrings
2026-09-30 | outer: Copilot | Brittle CSS contract matched `.messages-pane__menu` as `.messages-pane` | #388 | inner: exact selector with word boundary in `tests/messages-shell.test.js`
2026-09-30 | outer: Copilot | Em dash (U+2014) in product source / comments failed contract tests | #379 #398 #418 | inner: `npm run check:em-dash` / `scripts/check-em-dash.js` before push
2026-09-30 | outer: Copilot | Tests hardcoded service worker `CACHE_VERSION` (`tinker-shell-v13` / `v14`) | #391 #393 #394 | inner: read version from `src/renderer/sw.js` via `tests/helpers/sw-cache-version.js`; one format assertion in `tests/offline-shell.test.js`
2026-10-01 | outer: Copilot | Leads migration contract drifted after story-parts removal | #413 | inner: migration contract concatenates SQL from `prisma/migrations/` instead of a hand-kept list
2026-10-01 | inner: Cursor | Pre-push CI mirror + loop handoff | #419 | `npm run check`, `AGENTS.md` pre-push section, `.github/copilot-instructions.md`, this log
