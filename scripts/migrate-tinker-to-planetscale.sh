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
# creates the schema on the target with `prisma migrate deploy` (the
# migration is CREATE TABLE IF NOT EXISTS, so re-runs are safe), then
# copies the rows. The source (Neon) is never modified, so it stays as a
# rollback.
#
# Usage:
#   DATABASE_URL=<neon postgres url> \
#   PLANETSCALE_URL=<planetscale postgres url> \
#   scripts/migrate-tinker-to-planetscale.sh
#
set -euo pipefail

TABLE='public."TinkerUserData"'

die() { echo "error: $*" >&2; exit 1; }

command -v pg_dump >/dev/null 2>&1 || die "pg_dump not found — install the PostgreSQL client tools (e.g. \`brew install libpq\` or \`apt-get install postgresql-client\`)."
command -v psql    >/dev/null 2>&1 || die "psql not found — install the PostgreSQL client tools."

: "${DATABASE_URL:?set DATABASE_URL to the SOURCE (Neon) Postgres connection string}"
: "${PLANETSCALE_URL:?set PLANETSCALE_URL to the TARGET (PlanetScale) Postgres connection string}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> Creating TinkerUserData schema on the PlanetScale target (prisma migrate deploy)"
# `prisma migrate deploy` reads the datasource url from PLANETSCALE_URL
# (see prisma/schema.prisma). The migration uses CREATE TABLE IF NOT
# EXISTS, so this is idempotent.
( cd "$REPO_DIR" && npx --yes prisma migrate deploy )

echo "==> Copying TinkerUserData rows: Neon (source) -> PlanetScale (target)"
# --data-only: the schema already exists on the target (created above).
# --no-owner / --no-privileges: don't carry Neon-specific roles/grants.
pg_dump --data-only --no-owner --no-privileges \
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
