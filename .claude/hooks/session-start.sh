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
#
# Diagnostics are printed to stderr so they show up in the SessionStart
# hook output without polluting stdout (which the harness treats specially).

set -euo pipefail

log() { echo "[session-start] $*" >&2; }

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
  log "Skipping Vercel env pull. Missing: ${missing[*]}"
  log "Set these three vars in the Claude Code web environment for this repo."
  log "Without BROWSERBASE_API_KEY in the session env, the browserbase MCP"
  log "will load but fall back to its OAuth 'authenticate' flow instead of"
  log "using the URL-query API key in .mcp.json."
  exit 0
fi

mkdir -p .vercel
cat > .vercel/project.json <<EOF
{
  "projectId": "${VERCEL_PROJECT_ID}",
  "orgId": "${VERCEL_ORG_ID}"
}
EOF

# Surface vercel's own stderr so a bad token / wrong project ID / network
# error is visible in the SessionStart hook output. stdout is the progress
# bar — drop it so it doesn't show up in transcripts.
log "Pulling preview env from Vercel..."
if ! npx -y vercel@latest env pull \
      --environment=preview \
      --yes \
      --token "$VERCEL_TOKEN" \
      .env.local >/dev/null; then
  log "vercel env pull failed; continuing without preview secrets."
  log "Check that VERCEL_TOKEN has access to the project referenced by"
  log "VERCEL_PROJECT_ID=${VERCEL_PROJECT_ID} / VERCEL_ORG_ID=${VERCEL_ORG_ID}."
  exit 0
fi

if [ ! -s .env.local ]; then
  log "vercel env pull produced an empty .env.local; nothing to export."
  exit 0
fi

# Sanity-check the vars the browserbase MCP actually needs. The user is
# the only one who can fix a missing var in Vercel, so we log loudly but
# don't fail the hook (other tooling may still want the rest of the env).
for required in BROWSERBASE_API_KEY; do
  if ! grep -qE "^${required}=" .env.local; then
    log "WARNING: ${required} is missing from Vercel preview env."
    log "Add it via: vercel env add ${required} preview"
    log "The browserbase MCP will fall back to its OAuth auth flow until then."
  fi
done

# Propagate every KEY=value line from .env.local into CLAUDE_ENV_FILE so
# subsequent Bash tool calls — and .mcp.json's ${VAR} interpolation that
# the harness performs after this hook returns — see the secrets. The
# harness sets CLAUDE_ENV_FILE; if it's missing the vars only live in
# .env.local on disk.
if [ -z "${CLAUDE_ENV_FILE:-}" ]; then
  log "CLAUDE_ENV_FILE is not set; secrets stayed in .env.local only."
  log "Bash tools and the browserbase MCP won't see them this session."
  exit 0
fi

count=0
while IFS= read -r raw || [ -n "$raw" ]; do
  # Trim trailing CR (Vercel CLI on Windows shells writes CRLF).
  line="${raw%$'\r'}"
  # Skip blank lines and comments.
  [ -z "$line" ] && continue
  case "$line" in \#*) continue ;; esac
  # Match KEY=value where KEY is a valid shell identifier. The value can
  # contain anything (Vercel double-quotes its output, so embedded spaces
  # and special chars round-trip safely).
  if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
    echo "export $line" >> "$CLAUDE_ENV_FILE"
    count=$((count + 1))
  fi
done < .env.local

log "Exported $count env var(s) from Vercel preview scope to CLAUDE_ENV_FILE."
