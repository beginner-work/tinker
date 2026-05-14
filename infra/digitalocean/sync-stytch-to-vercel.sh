#!/usr/bin/env bash
# Push Stytch credentials into a Vercel project as environment variables.
#
# Designed to run on the DigitalOcean dev box (see infra/digitalocean/README.md)
# where outbound calls to the Stytch and Vercel APIs are not blocked by the
# Claude Code on the web sandbox firewall.
#
# Usage:
#   ./sync-stytch-to-vercel.sh <env-file> [vercel-env]
#
#   env-file   Path to a KEY=VALUE file with Stytch credentials. Lines
#              starting with `#` and blank lines are ignored. Quotes around
#              values are stripped. Example contents:
#
#                STYTCH_PROJECT_ID=project-test-...
#                STYTCH_SECRET=secret-test-...
#                STYTCH_PUBLIC_TOKEN=public-token-test-...
#
#   vercel-env Vercel environment scope: production | preview | development.
#              Default: production.
#
# Prereqs:
#   - vercel CLI installed and authenticated (`vercel login`).
#   - Run from inside a directory linked to the target Vercel project, or
#     `vercel link` first.
#
# Behaviour:
#   - Asks for confirmation before writing.
#   - If a variable already exists in the target scope, it is removed and
#     re-added (Vercel CLI has no atomic "upsert").
#   - Values are passed via stdin so they never appear in the process list.

set -euo pipefail

usage() {
  sed -n '2,/^set -/p' "$0" | sed -n '2,/^$/p; /^$/q' | sed 's/^# \{0,1\}//'
  exit 1
}

[[ $# -ge 1 ]] || usage

ENV_FILE="$1"
VERCEL_ENV="${2:-production}"

[[ -f "$ENV_FILE" ]] || { echo "error: env file not found: $ENV_FILE" >&2; exit 1; }

case "$VERCEL_ENV" in
  production|preview|development) ;;
  *) echo "error: vercel-env must be production, preview, or development" >&2; exit 1 ;;
esac

command -v vercel >/dev/null || { echo "error: vercel CLI not on PATH. Install with: npm i -g vercel" >&2; exit 1; }

if [[ ! -f .vercel/project.json ]]; then
  echo "error: this directory is not linked to a Vercel project."
  echo "       run: vercel link"
  exit 1
fi

# Parse env file into two parallel arrays.
NAMES=()
VALUES=()
while IFS= read -r line || [[ -n "$line" ]]; do
  # Strip comments and blanks.
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line//[[:space:]]/}" ]] && continue

  # Split on first '='.
  key="${line%%=*}"
  val="${line#*=}"

  # Trim whitespace from key.
  key="${key#"${key%%[![:space:]]*}"}"
  key="${key%"${key##*[![:space:]]}"}"

  # Strip a single layer of surrounding quotes from value.
  if [[ "$val" =~ ^\"(.*)\"$ ]] || [[ "$val" =~ ^\'(.*)\'$ ]]; then
    val="${BASH_REMATCH[1]}"
  fi

  [[ -n "$key" ]] || continue
  NAMES+=("$key")
  VALUES+=("$val")
done < "$ENV_FILE"

[[ ${#NAMES[@]} -gt 0 ]] || { echo "error: no variables parsed from $ENV_FILE" >&2; exit 1; }

echo
echo "About to write to Vercel ($VERCEL_ENV):"
for name in "${NAMES[@]}"; do
  echo "  - $name"
done
echo
read -r -p "Proceed? [y/N] " reply
[[ "$reply" =~ ^[Yy]$ ]] || { echo "aborted."; exit 0; }

for i in "${!NAMES[@]}"; do
  name="${NAMES[$i]}"
  value="${VALUES[$i]}"

  # Remove existing value silently — `vercel env rm` exits non-zero if the
  # variable doesn't exist, which is fine.
  vercel env rm "$name" "$VERCEL_ENV" --yes >/dev/null 2>&1 || true

  # Add the new value via stdin so it doesn't appear in ps/history.
  printf '%s' "$value" | vercel env add "$name" "$VERCEL_ENV" >/dev/null
  echo "  set $name"
done

echo
echo "Done. Verify with: vercel env ls $VERCEL_ENV"
