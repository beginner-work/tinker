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

Three independently-sufficient conditions combine to make migrations
unreliable on Vercel preview builds. Any one of them is enough to be
worth fixing; together they are why this fails every few days instead of
every build.

### 1. We run `prisma migrate deploy` through the PgBouncer pooler

Both `vercel.json` files set `buildCommand: "prisma migrate deploy"`, and
all three Prisma schemas read `DATABASE_URL`:

- `beginner/ui/vercel.json:7`
- `tinker/vercel.json:7`
- `beginner/ui/prisma/schema.prisma:17`, `beginner/api/prisma/schema.prisma:7`, `tinker/prisma/schema.prisma:16`

`DATABASE_URL` in production points at Neon's **pooled** endpoint
(`…-pooler.c-3.us-west-2.aws.neon.tech` — visible in the failure log).
Neon's pooler is PgBouncer in transaction-pooling mode.

Prisma's migration engine acquires a **session-scoped** Postgres advisory
lock (`pg_advisory_lock(...)`) at the start of `migrate deploy` to
serialise concurrent migrators. Session locks **must** stay attached to
the same backend for their lifetime. PgBouncer in transaction mode is
free to swap your client to a different backend between statements, so:

- The lock may end up held on a backend the next migration call cannot
  reach.
- The unlock may not arrive at the same backend that holds the lock, so
  the lock is "orphaned" until that backend goes idle.
- A subsequent migration call across the pool waits the full 10s
  hard-coded timeout and fails with **P1002**.

Prisma itself
[documents](https://pris.ly/d/migrate-advisory-locking) that the migration
engine needs a non-pooled connection.

### 2. Many builds race for the same lock on the same DB

Vercel runs **one build per push, per PR, per project**. We have two
projects (`beginner`, `tinker`) and any active commit on `main` or any
open PR triggers a redeploy on each. At the time `dpl_3wa1Gmhy5gTGQXcAQFtrieftJFaW`
failed, six other deploys against the same DB ran within ~10 minutes:

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

Even with a healthy direct connection, this much concurrency on a 10s
lock window will eventually time out. Through the pooler, it's a matter
of when, not if.

### 3. Migrations are re-run on every build, forever

We have **no** unapplied migrations. The full migration set has been
recorded in `_prisma_migrations` for weeks. Every Vercel build still
opens a connection, takes the advisory lock, reads `_prisma_migrations`,
confirms there is nothing to do, and releases the lock. The lock cost is
paid on every preview deploy for no benefit — a docs-only or
CSS-only PR with no schema change still contends for the migration lock.

---

## Mitigations (smallest first)

### M1. Add `directUrl` so the migration engine bypasses the pooler

Smallest, most targeted change. Prisma supports a separate
[`directUrl`](https://www.prisma.io/docs/orm/reference/prisma-schema-reference#fields-2)
that the migration engine and Studio use while the client keeps using
the pooled `url`.

Steps:

1. In Vercel project settings (both `beginner` and `tinker`), add a new
   env var `DIRECT_DATABASE_URL` pointing at the **non-pooled** Neon
   endpoint — same host with `-pooler` stripped. Available in the Neon
   console under the same branch.
2. In each `schema.prisma` datasource block, add `directUrl`:
   ```prisma
   datasource db {
     provider  = "postgresql"
     url       = env("DATABASE_URL")
     directUrl = env("DIRECT_DATABASE_URL")
   }
   ```
   Files: `beginner/ui/prisma/schema.prisma`,
   `beginner/api/prisma/schema.prisma`, `tinker/prisma/schema.prisma`.
3. Redeploy.

This is the single change that addresses the actual P1002. Session locks
will work correctly because the engine speaks to a real Postgres
backend, not PgBouncer.

### M2. Retry the migrate step on transient P1002

Wrap the build command so a single 10s lock-timeout doesn't kill the
deploy. Replace `prisma migrate deploy` in each `vercel.json` with a
script that retries with backoff:

```json
"buildCommand": "node scripts/migrate-with-retry.mjs"
```

where `scripts/migrate-with-retry.mjs` is ~20 lines: try `prisma migrate
deploy`, on non-zero exit and stderr matching `P1002`, sleep
2s/4s/8s, retry up to 3 attempts. Belt-and-suspenders to M1, not a
substitute — but cheap to add and survives the next transient incident.

### M3. Stop running `migrate deploy` on builds that don't change migrations

The 95% case is "PR touches CSS, no migrations changed". Skip the
migrate step entirely when `prisma/migrations/**` is untouched relative
to `main`:

```sh
# pseudo-code for vercel buildCommand
if git diff --quiet origin/main -- prisma/migrations; then
  echo "No migration changes — skipping migrate deploy"
  exit 0
fi
prisma migrate deploy
```

Caveat: Vercel's git context inside the build is shallow. The robust
form is to move migration application out of Vercel builds entirely — see
P1.

---

## Prevention (durable)

### P1. Move `prisma migrate deploy` out of Vercel builds into CI

Migrations belong on the merge-to-main path, run **once**, against the
direct URL, with a real lock budget. Add a `migrate` job to
`.github/workflows/ci.yml` that runs only on `push: main` and only when
`prisma/migrations/**` has changed:

```yaml
migrate:
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  runs-on: ubuntu-latest
  needs: [ui-check, api-unit]
  defaults: { run: { working-directory: ui } }
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 20, cache: npm, cache-dependency-path: ui/package-lock.json }
    - run: npm ci
    - run: npx prisma migrate deploy
      env:
        DATABASE_URL: ${{ secrets.PRISMA_DIRECT_URL }}
```

Then drop `prisma migrate deploy` from `ui/vercel.json` and
`tinker/vercel.json` entirely. The Vercel build becomes pure asset
output (and `prisma generate` via `postinstall`, which is fine — it
never touches the DB).

Net effect: previews stop migrating shared state. Production migration
runs exactly once per merge, in series.

### P2. One canonical migration source — not three

Today three Prisma schemas describe overlapping slices of one database:

- `beginner/api/prisma/schema.prisma` — full marketplace schema, owns
  most tables.
- `beginner/ui/prisma/schema.prisma` — tinker's subset
  (`ClaudeUser`, `ClaudePhoneVerification`, `TinkerUserData`).
- `tinker/prisma/schema.prisma` — same `TinkerUserData` mirror.

Two of these (`ui` and `tinker`) have migration directories, and both
run `migrate deploy` against the same DB. That's two independent
migration histories writing to a single `_prisma_migrations` table —
the only reason this hasn't caused divergence is that the
`20260515000000_add_tinker_user_data` migration is byte-identical in
both repos by convention.

Pick one repo (recommend `beginner` since it already owns the marketplace
schema and the Neon-pruning workflow) as the canonical migration owner.
The other two schemas keep only the model declarations they need for
Prisma Client generation, with `migrations/` removed. Only the canonical
repo runs `prisma migrate deploy`. The other two `postinstall` scripts
stay at `prisma generate`.

### P3. Use Neon per-PR branches for preview DBs

Preview deploys should never share the production DB. The Neon-Vercel
integration creates a per-PR Neon **database branch** with its own
endpoint and its own `DATABASE_URL`, isolated from main. The
`neon-branch-pruning.yml` workflow already exists in this repo and
expects this setup — turning it on completes the design.

This makes the migration question disappear for previews: each preview
gets a freshly-branched copy of main with all migrations already
applied. No `migrate deploy` step needed on the preview build.

To enable: install the [Neon-Vercel integration](https://neon.tech/docs/guides/vercel-overview)
on each project, set the per-PR branch creation policy, confirm preview
builds receive a `DATABASE_URL` whose hostname differs per PR.

---

## Recommended sequence

1. **Today (5 min):** add `directUrl` (M1). Resolves P1002 immediately.
2. **This week:** move `migrate deploy` into the CI workflow (P1). Drop it
   from `vercel.json`.
3. **This week:** turn on Neon per-PR branches (P3). The pruning workflow
   is already in place.
4. **Later:** consolidate the three Prisma schemas down to one
   migration-owning copy (P2).

Steps 1–3 together remove the failure mode entirely. Step 4 prevents the
class of bug ever returning by deleting the duplicate-history risk.
