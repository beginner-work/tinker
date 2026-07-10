# CLAUDE.md

Session behavior rules also live in [`AGENTS.md`](AGENTS.md) — read both.

## Branch & push workflow (IMPORTANT)

**Every feature push lands on `crafting`, every time — never stop at the
session's `claude/*` branch.** Deploys are gated to `main` + `crafting`
only (`vercel.json`'s `ignoreCommand`), so work that is pushed only to a
`claude/*` branch never builds and the user will not see it. `crafting`
is the single shared preview deploy; `main` ships production.

The default flow for any change:

1. **Rebase first.** `git fetch origin main && git rebase origin/main`
   on the session branch before writing code.
2. **Commit on the session branch** (the harness-assigned `claude/*`
   name) with a clear `feat(scope): …` message.
3. **Push the session branch** with `git push -u origin <branch>` and
   open a PR to `main` if one isn't already open. The PR is what makes
   the work permanent when merged — but the branch itself is PR
   plumbing only.
4. **Always merge onto crafting and push — this is the step that makes
   the work visible:**

   ```bash
   git fetch origin crafting
   git checkout -B crafting origin/crafting
   git merge --no-ff <session-branch> -m "Merge <session-branch> into crafting"
   git push origin crafting
   git checkout <session-branch>
   ```

5. Point the user at the **crafting** deployment (or the PR), never at
   a `claude/*` branch.

Do steps 3 and 4 together after each completed feature — don't batch
several features into one push, and never treat step 3 alone as "done".

`crafting` is disposable: only work merged to `main` is permanent, so
never do work that exists *only* on crafting.

## Project pointers

- `src/renderer/` — the web/desktop/mobile renderer (plain HTML/CSS/JS).
- `api/` — self-contained Vercel serverless functions (Stytch auth,
  Prisma to Postgres, server-side Anthropic key).
- `npm test` — `node --test tests/*.test.js`; keep it green before
  pushing. `node --check` any shipped JS you touch.
