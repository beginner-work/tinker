# Copilot coding agent (outer loop)

You own post-push CI fix-ups on this repo. Cursor agents own the pre-push inner loop. The two loops communicate only through the repository: read and write `AGENTS.md` and `docs/loop-log.md`.

## Before you open a CI fix PR

1. Read `AGENTS.md` (pre-push checks and test-contract rules).
2. Read `docs/loop-log.md`. If an entry already covers this failure type and lists a prevention, do not open another fix PR for the same class of failure unless main is still red for a new instance the prevention missed.
3. Prefer a lasting prevention idea over a one-off patch when both are small.

## When you open a CI fix PR

1. Append one line to `docs/loop-log.md` using the format in that file: date, `outer: Copilot`, failure type, the PR number, and a prevention idea for the inner loop (or `none yet`).
2. Put that same prevention idea in the PR body so a Cursor agent can harden `npm run check` / `AGENTS.md` without rediscovering the failure.
3. Leave other open Copilot fix-up PRs alone unless you are explicitly asked to touch them.

## Do not

- Close, comment on, rebase, or edit unrelated Copilot PRs.
- Skip the loop log when the PR exists only to make CI green.
