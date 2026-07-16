# AGENTS.md

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

## Cursor Cloud specific instructions

Node 22. Dependencies install via `npm install` (the update script already
runs this); its `postinstall` runs `prisma generate` (schema-only, no DB or
network). Standard commands live in `package.json` and `README.md`; notes
below are only the non-obvious cloud caveats.

- **Tests** (`npm test`): `node --test` over `tests/*.test.js`, no DB/network/
  display needed. This is the only thing CI runs (`.github/workflows/ci.yml`).
- **Lint** (`npm run lint`) is broken at the repo level, not by setup: ESLint 9
  needs an `eslint.config.js` that does not exist, so it exits non-zero with
  "couldn't find an eslint config file". CI does not run lint — don't treat this
  failure as a regression from your change.
- **Desktop app** (the flagship, needs no secrets): a TigerVNC X server runs on
  `DISPLAY=:1` (what the computer-use tool sees). Launch with
  `DISPLAY=:1 npx electron . --no-sandbox` (the `--no-sandbox` is required in
  this container; ignore the harmless `bus.cc`/GPU stderr warnings). Browsing
  and the "No AI" free-write flow work with zero env vars; the "AI" search path
  needs `ANTHROPIC_API_KEY` and otherwise shows a graceful "Couldn't reach
  Claude" error.
- **Web static host** (`npm run web`, port 5173): serves the shared renderer but
  the current plain-web build gates behind a Stytch phone-OTP sign-in that POSTs
  to `/api/*`, which this static host does NOT serve (405/404). README's
  "static-only browsing (no auth)" line is stale — the static host alone cannot
  get past the gate. To exercise the full web product end-to-end run
  `npx vercel dev` (serves `api/*`) with Stytch + `ANTHROPIC_API_KEY` (+
  `DATABASE_URL`, `STRIPE_SECRET_KEY`) secrets; see `README.md` for the list.
- **Mobile** (Capacitor iOS/Android) is not feasible in this Linux VM (needs
  macOS/Xcode or Android Studio).
