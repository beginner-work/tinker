#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# Two jobs:
#   1. Install node deps so tests/linters/MCP runners work.
#   2. Pull Vercel preview-scope env vars and expose them to the session
#      so .mcp.json's ${BROWSERBASE_API_KEY} placeholder interpolates and
#      Bash tools see the same secrets the preview deployment runs with.
#
# Vercel is the single source of truth for secrets. The only three vars
# that have to live outside Vercel (chicken-and-egg) are configured in
# the Claude Code web environment for this repo:
#
#   VERCEL_TOKEN       — read-only-by-default project token
#   VERCEL_PROJECT_ID  — from .vercel/project.json (run `vercel link` once locally)
#   VERCEL_ORG_ID      — same source
#
# Without them the hook still installs deps and exits cleanly — useful for
# local `claude` runs where the developer already has .env.local on disk.

set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(pwd)}"

if [ -f package.json ]; then
  npm install --no-audit --no-fund --prefer-offline
fi

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

missing=()
[ -z "${VERCEL_TOKEN:-}" ]      && missing+=("VERCEL_TOKEN")
[ -z "${VERCEL_PROJECT_ID:-}" ] && missing+=("VERCEL_PROJECT_ID")
[ -z "${VERCEL_ORG_ID:-}" ]     && missing+=("VERCEL_ORG_ID")
if [ "${#missing[@]}" -gt 0 ]; then
  echo "[session-start] Skipping Vercel env pull. Missing: ${missing[*]}" >&2
  echo "[session-start] Set these three vars in the Claude Code web environment for this repo." >&2
  exit 0
fi

mkdir -p .vercel
cat > .vercel/project.json <<EOF
{
  "projectId": "${VERCEL_PROJECT_ID}",
  "orgId": "${VERCEL_ORG_ID}"
}
EOF

if ! npx -y vercel@latest env pull \
      --environment=preview \
      --yes \
      --token "$VERCEL_TOKEN" \
      .env.local >/dev/null 2>&1; then
  echo "[session-start] vercel env pull failed; continuing without preview secrets." >&2
  exit 0
fi

if [ -f .env.local ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  while IFS= read -r raw || [ -n "$raw" ]; do
    line="${raw%$'\r'}"
    [ -z "$line" ] && continue
    case "$line" in
      \#*) continue ;;
      [A-Za-z_]*=*) echo "export $line" >> "$CLAUDE_ENV_FILE" ;;
    esac
  done < .env.local
fi
