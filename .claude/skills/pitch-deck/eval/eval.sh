#!/usr/bin/env bash
# pitch-deck/eval/eval.sh
#
# Asserts a pitch-deck.md is consistent with the canonical fixture
# (the answers documented in fixture.md, which produced the reference
# `beginner` deck). The eval is content-level — it doesn't byte-match,
# since LLM output varies — but the must / must-not lists are the
# fingerprints proving the founder's actual answers landed.
#
# Usage:
#   ./eval.sh                          # checks ./pitch-deck.md
#   ./eval.sh path/to/pitch-deck.md    # checks a specific file
#
# Exits 0 on pass, non-zero with a count on any failed assertion.

set -euo pipefail

DECK="${1:-pitch-deck.md}"

if [[ ! -f "$DECK" ]]; then
  echo "FAIL: $DECK not found"
  exit 2
fi

# Fingerprints that prove the canonical answers landed in the deck.
# See fixture.md for the answers each one corresponds to.
MUST_APPEAR=(
  '$300K'
  'one month'
  'San Diego'
  'San Francisco'
  'Filipino'
  'barber'
  'Studio'
  'beginner'
  'AI-native'
  '## 1. The problem'
  'The line in the sand'
)

# Fixed-string banned phrases — jargon the skill forbids and
# fabricated-citation patterns the skill warns against.
MUST_NOT_APPEAR=(
  'synergy'
  'go-to-market'
  '(Pew, 2023)'
  'tens of millions globally'
  '$Xbn'
  'massive market'
)

fail=0

for needle in "${MUST_APPEAR[@]}"; do
  if ! grep -qF -- "$needle" "$DECK"; then
    echo "MISSING: $needle"
    fail=$((fail + 1))
  fi
done

for needle in "${MUST_NOT_APPEAR[@]}"; do
  if grep -qF -- "$needle" "$DECK"; then
    echo "FORBIDDEN: $needle"
    fail=$((fail + 1))
  fi
done

# Banned word forms (regex — any conjugation):
if grep -qiE '\bdisrupt(s|ed|ing|ion|ive)?\b' "$DECK"; then
  echo "FORBIDDEN: 'disrupt' (any form) — re-word"
  fail=$((fail + 1))
fi

# 'leverage' as a verb is banned; the noun is rare in a deck so we
# flag any occurrence and let a human override if the noun is the
# intent. (Likely false-positive rate is low.)
if grep -qiE '\bleverag(e|es|ed|ing)\b' "$DECK"; then
  echo "FORBIDDEN: 'leverage' (verb) — re-word"
  fail=$((fail + 1))
fi

if [[ $fail -gt 0 ]]; then
  echo
  echo "EVAL FAILED — $fail assertion(s) failed against $DECK"
  exit 1
fi

echo "EVAL PASSED — $DECK matches the canonical fixture."
