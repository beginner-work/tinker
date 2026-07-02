#!/bin/bash
set -euo pipefail

# setup-prod-domain.sh
#
# Point production at https://tinker.beginner.work — end to end, from a
# single command with no prior setup:
#
#   ./scripts/setup-prod-domain.sh
#
# What it does:
#   1. Verifies prerequisites (node, curl). Installs the Vercel CLI
#      globally via npm if missing, with consent.
#   2. Logs into Vercel if needed (`vercel login`), scoped to the
#      beginner-work team.
#   3. Attaches tinker.beginner.work to the `tinker` Vercel project
#      (production target). Safe to re-run — an already-attached domain
#      is detected and skipped.
#   4. Creates the DNS record in Cloudflare (beginner.work's DNS host):
#      CNAME tinker → cname.vercel-dns.com, **DNS-only** (grey cloud).
#      Proxying through Cloudflare would sit in front of Vercel's edge
#      and break Vercel's automatic TLS issuance, so the record must
#      stay unproxied. Needs a Cloudflare API token with Zone → DNS →
#      Edit on beginner.work — pass it as $CLOUDFLARE_API_TOKEN or the
#      script prompts for it (create one at
#      https://dash.cloudflare.com/profile/api-tokens).
#      Idempotent: an existing correct record is left alone; a record
#      pointing elsewhere (or proxied) is fixed with consent.
#   5. If Vercel asks for extra ownership verification (a _vercel TXT
#      record — happens when the domain was previously claimed by
#      another account), offers to create that record too.
#   6. Polls https://tinker.beginner.work until Vercel serves it with a
#      valid certificate, then prints a summary.
#
# The old production URL (tinker-theta.vercel.app) keeps working —
# Vercel retains the default domains alongside custom ones.

DOMAIN="tinker.beginner.work"
APEX="beginner.work"
SUBLABEL="tinker"
PROJECT="tinker"
TEAM_SCOPE="beginner-work"
CNAME_TARGET="cname.vercel-dns.com"
CF_API="https://api.cloudflare.com/client/v4"

step() { printf "\n\033[1;36m==>\033[0m \033[1m%s\033[0m\n" "$1"; }
ok()   { printf "  \033[1;32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[1;33m!\033[0m %s\n" "$1"; }
err()  { printf "  \033[1;31m✗\033[0m %s\n" "$1" >&2; }

if [[ ! -t 0 ]]; then
  err "This script is interactive; run it in a real terminal."
  exit 2
fi

# jq-free JSON field extraction (node ships with the Vercel CLI anyway).
json_get() { # json_get '<expr over parsed stdin as j>'
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d||'null');const v=($1);process.stdout.write(v==null?'':String(v));});"
}

# ── 1. Prerequisites ─────────────────────────────────────────────────────────

step "Checking prerequisites"

for bin in node curl; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    err "$bin is required but not installed. Install it and re-run."
    exit 2
  fi
done
ok "node $(node --version), curl present"

if ! command -v vercel >/dev/null 2>&1; then
  warn "Vercel CLI not found."
  read -rp "  Install it globally via 'npm i -g vercel'? [Y/n] " reply
  if [[ -z "$reply" || "$reply" =~ ^[Yy]$ ]]; then
    npm i -g vercel
  else
    err "Vercel CLI required. Aborting."
    exit 2
  fi
fi
ok "vercel $(vercel --version 2>/dev/null | head -1)"

# ── 2. Vercel auth ───────────────────────────────────────────────────────────

step "Checking Vercel login"

if ! vercel whoami --scope "$TEAM_SCOPE" >/dev/null 2>&1; then
  warn "Not logged in (or no access to the $TEAM_SCOPE team yet)."
  vercel login
fi
ok "Logged in as $(vercel whoami --scope "$TEAM_SCOPE" 2>/dev/null | tail -1)"

# ── 3. Attach the domain to the project ──────────────────────────────────────

step "Attaching $DOMAIN to the '$PROJECT' project"

set +e
add_out="$(vercel domains add "$DOMAIN" "$PROJECT" --scope "$TEAM_SCOPE" 2>&1)"
add_rc=$?
set -e
if [[ $add_rc -eq 0 ]]; then
  ok "Domain attached."
elif grep -qiE "already|in use by one of your projects" <<<"$add_out"; then
  ok "Domain already attached — skipping."
else
  err "vercel domains add failed:"
  printf '%s\n' "$add_out" >&2
  exit 1
fi

# ── 4. Cloudflare DNS ────────────────────────────────────────────────────────

step "Configuring DNS on Cloudflare ($APEX zone)"

CF_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
if [[ -z "$CF_TOKEN" ]]; then
  warn "No \$CLOUDFLARE_API_TOKEN in the environment."
  echo "  Create a token with Zone → DNS → Edit on $APEX:"
  echo "  https://dash.cloudflare.com/profile/api-tokens"
  read -rsp "  Paste the Cloudflare API token: " CF_TOKEN; echo
fi

cf() { # cf METHOD PATH [JSON_BODY]
  local method="$1" path="$2" body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -X "$method" "$CF_API$path" \
      -H "Authorization: Bearer $CF_TOKEN" \
      -H "Content-Type: application/json" \
      --data "$body"
  else
    curl -sS -X "$method" "$CF_API$path" \
      -H "Authorization: Bearer $CF_TOKEN"
  fi
}

if [[ "$(cf GET /user/tokens/verify | json_get 'j.success')" != "true" ]]; then
  err "Cloudflare token failed verification. Check the token and re-run."
  exit 1
fi
ok "Cloudflare token verified."

zone_id="$(cf GET "/zones?name=$APEX" | json_get 'j.result && j.result[0] && j.result[0].id')"
if [[ -z "$zone_id" ]]; then
  err "The token can't see the $APEX zone. Grant it Zone → DNS → Edit on $APEX."
  exit 1
fi
ok "Zone found: $zone_id"

existing="$(cf GET "/zones/$zone_id/dns_records?name=$DOMAIN")"
rec_id="$(json_get 'j.result && j.result[0] && j.result[0].id' <<<"$existing")"
rec_type="$(json_get 'j.result && j.result[0] && j.result[0].type' <<<"$existing")"
rec_content="$(json_get 'j.result && j.result[0] && j.result[0].content' <<<"$existing")"
rec_proxied="$(json_get 'j.result && j.result[0] && j.result[0].proxied' <<<"$existing")"

record_body="{\"type\":\"CNAME\",\"name\":\"$SUBLABEL\",\"content\":\"$CNAME_TARGET\",\"ttl\":1,\"proxied\":false,\"comment\":\"tinker production on Vercel — must stay DNS-only for Vercel TLS\"}"

if [[ -z "$rec_id" ]]; then
  create="$(cf POST "/zones/$zone_id/dns_records" "$record_body")"
  if [[ "$(json_get 'j.success' <<<"$create")" != "true" ]]; then
    err "Failed to create the CNAME record:"
    printf '%s\n' "$create" >&2
    exit 1
  fi
  ok "Created: CNAME $DOMAIN → $CNAME_TARGET (DNS-only)."
elif [[ "$rec_type" == "CNAME" && "$rec_content" == "$CNAME_TARGET" && "$rec_proxied" == "false" ]]; then
  ok "Correct record already exists — skipping."
else
  warn "A $rec_type record for $DOMAIN already exists (content: $rec_content, proxied: $rec_proxied)."
  read -rp "  Replace it with an unproxied CNAME → $CNAME_TARGET? [Y/n] " reply
  if [[ -z "$reply" || "$reply" =~ ^[Yy]$ ]]; then
    update="$(cf PUT "/zones/$zone_id/dns_records/$rec_id" "$record_body")"
    if [[ "$(json_get 'j.success' <<<"$update")" != "true" ]]; then
      err "Failed to update the record:"
      printf '%s\n' "$update" >&2
      exit 1
    fi
    ok "Updated: CNAME $DOMAIN → $CNAME_TARGET (DNS-only)."
  else
    err "Leaving the existing record in place — Vercel won't be able to serve $DOMAIN."
    exit 1
  fi
fi

# ── 5. Ownership verification (only needed if Vercel asks) ──────────────────

step "Checking whether Vercel needs extra ownership verification"

inspect_out="$(vercel domains inspect "$DOMAIN" --scope "$TEAM_SCOPE" 2>&1 || true)"
txt_value="$(grep -oE '"?vc-domain-verify=[^" ]+"?' <<<"$inspect_out" | head -1 | tr -d '"' || true)"
if [[ -n "$txt_value" ]]; then
  warn "Vercel wants a TXT record on _vercel.$APEX to prove ownership."
  read -rp "  Create it in Cloudflare now? [Y/n] " reply
  if [[ -z "$reply" || "$reply" =~ ^[Yy]$ ]]; then
    txt_body="{\"type\":\"TXT\",\"name\":\"_vercel\",\"content\":\"$txt_value\",\"ttl\":1}"
    create="$(cf POST "/zones/$zone_id/dns_records" "$txt_body")"
    if [[ "$(json_get 'j.success' <<<"$create")" == "true" ]]; then
      ok "TXT _vercel.$APEX created."
    else
      warn "Couldn't create the TXT record automatically:"
      printf '%s\n' "$create" >&2
      echo "  Add it manually: TXT _vercel.$APEX → $txt_value"
    fi
  else
    echo "  Add it manually before the domain can verify: TXT _vercel.$APEX → $txt_value"
  fi
else
  ok "No extra verification required."
fi

# ── 6. Wait for the edge ─────────────────────────────────────────────────────

step "Waiting for https://$DOMAIN to come up (DNS + certificate issuance)"

deadline=$((SECONDS + 300))
while (( SECONDS < deadline )); do
  headers="$(curl -sI --max-time 10 "https://$DOMAIN" 2>/dev/null || true)"
  status="$(head -1 <<<"$headers" | grep -oE '[0-9]{3}' | head -1 || true)"
  if grep -qi '^server: *vercel' <<<"$headers" && [[ -n "$status" && "$status" -lt 500 ]]; then
    ok "Live: https://$DOMAIN (HTTP $status, served by Vercel)."
    break
  fi
  printf "  … not ready yet (HTTP %s), retrying in 15s\n" "${status:-—}"
  sleep 15
done

if (( SECONDS >= deadline )); then
  warn "Timed out after 5 minutes. DNS can take a little longer to propagate."
  echo "  Current status from Vercel:"
  vercel domains inspect "$DOMAIN" --scope "$TEAM_SCOPE" || true
  echo "  Re-run this script any time — every step is idempotent."
  exit 1
fi

# ── 7. Summary ───────────────────────────────────────────────────────────────

step "Done"
ok "Production is live at https://$DOMAIN"
ok "The previous URL (https://tinker-theta.vercel.app) still works."
echo
echo "  Follow-up (optional): the beginner repo links to the old URL in"
echo "  ui/public/index.html, welcome/, signup.js, founderview.js and"
echo "  api/download/mac.js — update those to https://$DOMAIN when you"
echo "  want the branded URL everywhere."
