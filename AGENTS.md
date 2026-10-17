# AGENTS.md

## Before every push

Before any `git push`, run the full suites exactly as CI does:

1. Unit + UI-contract: `npm test`
2. Visual regression: `npm run test:visual`

Both must pass. Update visual baselines (`npm run test:visual:update`) only for intended UI changes, and commit those PNGs in the same PR. Never push red.

## Session behavior

### Always close with a question

After finishing the entirety of the requested work, always end the turn
with a single follow-up question (use `AskUserQuestion` so the choices
are first-class). The question surfaces the obvious next step: what to
verify, which ambiguity to resolve, or which follow-on to take.

One of the answer options must always be **"Ship it and merge"** — the
shortcut the user picks when the change is good as-is and should go out
without further iteration. Pair it with 2–3 other context-relevant
options (e.g. verify locally, iterate on a specific aspect, hold off).

When the user picks "Ship it and merge", merge the PR directly if it's
mergeable; if it's blocked on CI or required checks, enable auto-merge
via `mcp__github__enable_pr_auto_merge` so it merges as soon as checks
pass.

Even when the work feels fully complete, close with this question
rather than a flat "done." Skip it only when the user's message itself
was a direct question that has been fully answered with no follow-on
work pending, or when all PRs on the session have been merged.
