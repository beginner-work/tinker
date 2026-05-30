# Daily pitch-deck metrics refresh

A recurring [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web)
session runs once a day, pulls two live numbers, writes them onto the Traction
slide of `pitch-deck.md`, re-exports the deck, and commits the result.

## What gets updated

`scripts/update-pitch-metrics.mjs` rewrites a single marked timeline item on the
Traction slide (the `<!-- LIVE-METRICS -->` `<li>`):

> **May 30, 2026** — 10 registered users · 1 paying engineer — live today.

- **registered users** → Stytch Search Users API (`POST /v1/users/search`,
  `results_metadata.total`). Same `STYTCH_PROJECT_ID` / `STYTCH_SECRET` the app
  uses in `api/_lib/stytch.js`.
- **paying engineers** → count of `status=active` Stripe subscriptions
  (`STRIPE_SECRET_KEY`).

The edit is idempotent — each run replaces the marked line in place, so the deck
never accumulates duplicate entries.

## Prerequisites (one-time)

The scheduled session's **environment** must have these env vars (they are not
needed locally otherwise — they live in Vercel today):

- `STYTCH_PROJECT_ID`
- `STYTCH_SECRET`
- `STRIPE_SECRET_KEY`

Add them under the environment's configuration in the Claude Code web app. See
the [env / setup docs](https://code.claude.com/docs/en/claude-code-on-the-web).

PDF export needs a headless Chromium; the script makes the PDF best-effort and
always regenerates `pitch-deck.html` (which does not need Chromium).

## Set up the schedule

In the Claude Code web app, create a **daily scheduled session** against this
repo with the following prompt:

```
In the tinker repo, run: node scripts/update-pitch-metrics.mjs

Then:
- If pitch-deck.md / pitch-deck.html / pitch-deck.pdf changed, commit with
  message "chore: refresh pitch deck live metrics (<today's date>)" and push.
- If the numbers are unchanged (no diff), do nothing and end the session.
- If the script fails because Stytch/Stripe credentials are missing or an API
  call errors, do not edit the deck — report the error and stop.
```

> Pick the branch the schedule should push to. Until this work is merged it
> targets `claude/stytch-mcp-user-count-MgdEX`; point the schedule at `main`
> once merged.

## Run it manually

```bash
# Real numbers (needs the env vars above):
node scripts/update-pitch-metrics.mjs

# Offline check of the edit logic (placeholder numbers, no rebuild):
node scripts/update-pitch-metrics.mjs --dry-run

# Update the markdown but skip the marp re-export:
node scripts/update-pitch-metrics.mjs --no-build
```
