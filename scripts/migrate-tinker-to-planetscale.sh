#!/usr/bin/env bash
#
# Move tinker's TinkerUserData table from the old shared Neon Postgres to
# tinker's own PlanetScale for Postgres database.
#
# This is the PlanetScale-recommended "simplest" import path for a small
# database: a plain pg_dump | psql copy (Postgres -> Postgres, no engine
# conversion). For larger datasets PlanetScale documents pgcopydb / WAL
# replication / Amazon DMS instead — see
# https://planetscale.com/docs/postgres/imports/postgres-imports
#
# Before a production cutover, PlanetScale also recommends running their
# Discovery Tool against the source DB to confirm compatibility:
# https://planetscale.com/migrate
#
# Self-contained: checks its prerequisites and the two connection strings,
# then copies the TinkerUserData table (schema + data) straight from Neon
# into PlanetScale with pg_dump | psql. The source (Neon) is never
# modified, so it stays as a rollback.
#
# IMPORTANT: PLANETSCALE_URL must use a role that can create objects in the
# public schema (PlanetScale's administrative/"Default" role). The runtime
# app role is DML-only and would fail with "permission denied for schema
# public" — that is why the app build no longer runs `prisma migrate
# deploy` (see vercel.json) and DDL is applied here / via deploy requests.
#
# Usage:
#   DATABASE_URL=<neon postgres url> \
#   PLANETSCALE_URL=<planetscale postgres admin url> \
#   scripts/migrate-tinker-to-planetscale.sh
#
set -euo pipefail

TABLE='public."TinkerUserData"'

die() { echo "error: $*" >&2; exit 1; }

command -v pg_dump >/dev/null 2>&1 || die "pg_dump not found — install the PostgreSQL client tools (e.g. \`brew install libpq\` or \`apt-get install postgresql-client\`)."
command -v psql    >/dev/null 2>&1 || die "psql not found — install the PostgreSQL client tools."

: "${DATABASE_URL:?set DATABASE_URL to the SOURCE (Neon) Postgres connection string}"
: "${PLANETSCALE_URL:?set PLANETSCALE_URL to the TARGET (PlanetScale) Postgres admin connection string}"

echo "==> Copying TinkerUserData (schema + data): Neon (source) -> PlanetScale (target)"
# Plain pg_dump of just the one table — includes CREATE TABLE / index / PK
# plus the rows (PlanetScale's recommended pg_dump | psql import path).
# --no-owner / --no-privileges: don't carry Neon-specific roles/grants.
# Target table must not already exist (this is a one-time, empty-target load).
pg_dump --no-owner --no-privileges \
        --table="$TABLE" "$DATABASE_URL" \
  | psql --set ON_ERROR_STOP=on "$PLANETSCALE_URL"

echo "==> Verifying row counts"
src_count="$(psql -At "$DATABASE_URL"     -c "SELECT count(*) FROM $TABLE;")"
dst_count="$(psql -At "$PLANETSCALE_URL"  -c "SELECT count(*) FROM $TABLE;")"
echo "    source (Neon):       $src_count rows"
echo "    target (PlanetScale): $dst_count rows"

if [ "$src_count" = "$dst_count" ]; then
  echo "==> Done. Row counts match. Neon is untouched and can serve as a rollback."
else
  die "row counts differ (source=$src_count target=$dst_count) — inspect before cutting over. The target may already have had rows; this loader expects an empty target table."
fi
