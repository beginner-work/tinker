# AGENTS.md

## Inner loop and outer loop

- **Inner loop (Cursor agents):** pre-push work. Catch CI failures before push.
- **Outer loop (GitHub Copilot coding agent):** post-push CI fix-ups.
- Communicate only through the repo. Before starting work, read `docs/loop-log.md`.
- When you add a new check or change a test contract, append one line to `docs/loop-log.md` (see the format there).

## Pre-push checks (required)

Before every push, run and pass:

```bash
npm run check
```

That script mirrors what CI and Vercel run, in this order:

1. `prisma generate` (npm `postinstall` and `vercel.json` `buildCommand`)
2. Em dash check (`scripts/check-em-dash.js`) for contract-scanned product surfaces
3. Unit-glob check (`scripts/check-unit-glob.js`) so Playwright stays out of `tests/*.test.js`
4. `npm test` (`node --test tests/*.test.js`, same as `.github/workflows/ci.yml`)

Do not push if `npm run check` fails.

### Test and contract rules

- **E2E naming:** Playwright specs are `tests/*.e2e.js`. Unit discovery is only `tests/*.test.js`. Never `require("playwright")` from a `*.test.js` file. Run mobile E2E with `npm run test:e2e:mobile` when needed.
- **Em dashes:** Do not introduce U+2014 in contract-scanned product source (see `scripts/check-em-dash.js`). Prefer hyphen, colon, or period.
- **Service worker cache version:** Do not hardcode `tinker-shell-vNN` in tests. Read it from `src/renderer/sw.js` via `tests/helpers/sw-cache-version.js`. Keep a single format assertion in `tests/offline-shell.test.js`.
- **Exact matches in contract tests:** CSS selectors need a word boundary so `.messages-pane` does not match `.messages-pane__menu`. MCP tool exclusions and expectations use exact tool names (for example `list_approved_outreach`), never a substring like `/approve/`.
- **Migrations:** Leads migration contract tests derive SQL from the `prisma/migrations/` folder, not a hand-kept filename list. After schema changes, keep bootstrap SQL and migrations aligned, then run `npm run check`.

## Session behavior

### Always close with a question

After finishing the entirety of the requested work, always end the turn
with a single follow-up question (use `AskUserQuestion` so the choices
are first-class). The question surfaces the obvious next step: what to
verify, which ambiguity to resolve, or which follow-on to take.

One of the answer options must always be **"Ship it and merge"** - the
shortcut the user picks when the change is good as-is and should go out
without further iteration. Pair it with 2-3 other context-relevant
options (e.g. verify locally, iterate on a specific aspect, hold off).

When the user picks "Ship it and merge", merge the PR directly if it's
mergeable; if it's blocked on CI or required checks, enable auto-merge
via `mcp__github__enable_pr_auto_merge` so it merges as soon as checks
pass.

Even when the work feels fully complete, close with this question
rather than a flat "done." Skip it only when the user's message itself
was a direct question that has been fully answered with no follow-on
work pending, or when all PRs on the session have been merged.
