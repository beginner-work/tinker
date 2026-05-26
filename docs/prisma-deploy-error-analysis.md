# Prisma `migrate deploy` failures on Vercel preview — root cause + fixes

Recurring symptom: Vercel preview builds fail with **Prisma `P1002`** during
the `prisma migrate deploy` step. The build immediately retried succeeds.
Both the `beginner` and `tinker` projects exhibit it. The most recent
occurrences were captured directly from Vercel build logs:

```
Error: P1002

The database server at `ep-delicate-art-ak2qmsls-pooler.c-3.us-west-2.aws.neon.tech:5432`
was reached but timed out.

Context: Timed out trying to acquire a postgres advisory lock
(SELECT pg_advisory_lock(72707369)). Elapsed: 10000ms.
See https://pris.ly/d/migrate-advisory-locking for details.

Error: Command "prisma migrate deploy" exited with 1
```

Confirmed instances (Vercel deployment IDs):

| Project  | Deployment                              | Branch                           | Result |
|----------|-----------------------------------------|----------------------------------|--------|
| tinker   | `dpl_3wa1Gmhy5gTGQXcAQFtrieftJFaW`      | `claude/loader-design-system-6VXlP` (PR #176) | P1002 |
| beginner | `dpl_Ym8Rw34n8JWc4vy1jstpmSydZGjs`      | `main` (production)              | P1002 |

The advisory-lock id `72707369` is identical in both — Prisma derives it
deterministically from the migration-engine identity, so every project
that runs `prisma migrate deploy` against this database contends for the
**same** lock.

---

## Root cause

**Every Vercel preview deploy runs `prisma migrate deploy` against the
same Neon database that production uses.** The endpoint hostname in the
failure log — `ep-delicate-art-ak2qmsls-pooler…` — is the one DB the
whole org points at, regardless of which PR or branch the build came
from. Preview is not isolated. Production is not isolated from preview.

That single fact is what's actually breaking. The P1002 error is just
how it surfaces: when two builds hit the shared DB inside the same 10s
window, they race for the migration engine's advisory lock and one
loses. There's nothing wrong with the migration. There's nothing wrong
with the DB. The system is doing exactly what it was wired to do —
serialise migrations against a shared resource — and the resource is too
shared to serialise cheanly given how often we deploy.

A few mechanisms compound the failure rate, but none of them are the
root cause:

- The `DATABASE_URL` we point migrations at is the **pooled** Neon
  endpoint (`…-pooler…`). PgBouncer in transaction-pooling mode can
  swap a client to a different backend between statements, so the
  session-scoped `pg_advisory_lock(...)` may end up held on a backend
  the next migration call can't reach. This makes lock contention
  resolve as a hung-then-timed-out call instead of a fast acquire.
- Vercel runs **one build per push, per PR, per project**. With two
  projects, six other `prisma migrate deploy` runs hit the same DB
  within a 10-minute window around the captured failure:
  ```
  1779828324518  tinker     PR #175   migrate deploy
  1779828378779  tinker     PR #178   migrate deploy
  1779828559953  tinker     main      migrate deploy
  1779828614974  tinker     PR #176   migrate deploy   ← later succeeded
  1779828629894  tinker     PR #174   migrate deploy
  1779828796334  tinker     main      migrate deploy
  1779828935495  tinker     PR #176   migrate deploy
  1779828941708  beginner   PR #496   migrate deploy
  1779829274430  tinker     PR #176   migrate deploy   ← FAILED (P1002)
  1779829280362  beginner   PR #496   migrate deploy
  ```
- `prisma migrate deploy` runs on every build, every PR, even when no
  migration changed. A CSS-only PR still queues for the migration lock
  on the production DB.

All three of those are symptoms of the same architectural fact: there's
one DB, and everything is hitting it.

---

## The fix: give each preview its own database

The Neon-Vercel integration turns this into a non-problem. On PR open,
Neon creates a child branch of the main DB (full copy-on-write, fast,
free at our usage), and the Vercel preview for that PR gets a
`DATABASE_URL` whose hostname is **specific to that branch**. The
preview's `prisma migrate deploy` runs against the preview's own
`_prisma_migrations` table, with its own advisory locks, on its own
Postgres backend. Production is untouched. Other PRs are untouched.
P1002 cannot happen because there is no contention.

How we know this is the right answer for this repo:

- The Neon API key and project id are already wired up in CI secrets
  (`NEON_API_KEY`, `NEON_PROJECT_ID` referenced in
  `.github/workflows/neon-branch-pruning.yml`).
- `scripts/neon-prune.mjs` already exists, expecting per-PR `pr-<N>`
  and `preview/<head ref>` branch naming — i.e. the cleanup half of
  the integration is shipped, but the create half isn't turned on.
- Closed-PR cleanup is wired (`pull_request: closed` event), so
  branches won't leak.

What's left to do:

1. Install the [Neon-Vercel integration](https://neon.tech/docs/guides/vercel-overview)
   on each Vercel project (`beginner`, `tinker`).
2. In Neon, set the branch policy: "create a branch for each Vercel
   preview deployment, named after the git head ref."
3. Confirm preview builds receive a `DATABASE_URL` whose hostname
   differs per PR. Trigger any preview, read the build log line
   `Datasource "db": PostgreSQL database "neondb"… at "ep-..."` — the
   `ep-` prefix should not match production.
4. Leave `prisma migrate deploy` in `vercel.json` for now. With per-PR
   DBs, it becomes a fast no-op on previews (migrations already applied
   on the branched-from snapshot) and a real apply only on the
   production deploy.

That's the whole fix. After step 3, the next P1002 should be the last
P1002.

---

## What about the symptoms?

Worth fixing on their own merits even after isolation is in place,
because they reduce blast radius if anything goes sideways during the
rollout:

- **Add `directUrl` to `schema.prisma`** so the migration engine
  bypasses the pooler. Five-minute change in
  `beginner/ui/prisma/schema.prisma`,
  `beginner/api/prisma/schema.prisma`,
  `tinker/prisma/schema.prisma`:
  ```prisma
  datasource db {
    provider  = "postgresql"
    url       = env("DATABASE_URL")
    directUrl = env("DIRECT_DATABASE_URL")
  }
  ```
  Set `DIRECT_DATABASE_URL` in Vercel to the non-pooled Neon endpoint.
  Even with per-PR DBs, this is the correct way to wire Prisma —
  session-scoped advisory locks work reliably and Studio/seed scripts
  also stop fighting the pooler.

- **Consolidate the three Prisma schemas.** Today
  `beginner/api/prisma/schema.prisma`, `beginner/ui/prisma/schema.prisma`,
  and `tinker/prisma/schema.prisma` each declare partial overlapping
  slices of one database, and two of them (`ui` and `tinker`) carry
  their own `migrations/` directories. With per-PR DBs the duplicate
  migration histories stop colliding in production, but they still rot
  independently — pick one repo (recommend `beginner`, since it owns
  the marketplace schema and the Neon-pruning workflow) as the
  canonical migration source, drop `migrations/` from the others, and
  let the slim schemas exist only for Prisma Client generation.

---

## Recommended sequence

1. **Today:** turn on the Neon-Vercel per-PR branch integration. This is
   the actual fix.
2. **This week:** add `directUrl` to all three schemas. Defensive depth
   for the migration engine.
3. **Later:** consolidate the three Prisma schemas down to one
   migration-owning copy.

Step 1 alone resolves the recurring P1002 in production. Step 2 closes
the underlying pooler-vs-session-lock bug so it can't reappear if
someone ever points migrations at the shared DB by accident. Step 3
removes the duplicate-migration-history risk for good.
