# Claude / agent notes

## Resume metrics

`RESUME_METRICS.md` at the repo root is the guardrail contract for resume
line items. Keep it in place; do not relocate definitions to
`evals/METRICS.md`. Event names in `src/renderer/lib/metrics/events.js`
must match that file (CI drift test). Goals only in `DO_NOT_PUBLISH*`.
Owner traffic (`?owner=1`) is always excluded from metrics.

Also see `AGENTS.md` for pre-push test requirements and session closing
behavior.
