# Metrics cardinality under load (45 minutes)

## Goal

Diff `baseline.js` (unbounded labels) against `better.js` (bounded route + status labels). Prove series count stays flat under a fake load. No Prometheus or Grafana processes.

## Setup

Nothing to install. Open this folder in the Tinker IDE.

## What to change

1. Read `baseline.js`. Each request labels `user_id` + full path.
2. Read `better.js`. Labels only `route` and `status`.
3. Edit toward bounded labels.
4. Run the check.

## How to verify

```bash
node check.mjs
```

Done when better `series` stays small while baseline grows with unique users.

## Stretch (optional)

- Add a recording-rule helper that computes a 5m-style success ratio from the bounded counters.
- Add a burn-rate predicate for a 99% SLO and a tiny runbook comment block.
