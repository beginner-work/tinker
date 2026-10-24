# Optimizely at the edge (45 minutes)

## Goal

Diff `baseline.js` (fake network decide on every call) against `better.js` (local datafile evaluation). Prove local decide is faster under a concurrent batch. No Optimizely account.

## Setup

Nothing to install. Open this folder in the Tinker IDE.

## What to change

1. Read `baseline.js`. Every `decide` awaits a fake CDN delay.
2. Read `better.js`. Flags resolve from an in-memory datafile (Optimizely-shaped).
3. Edit toward local evaluation.
4. Run the check.

## How to verify

```bash
node check.mjs
```

Done when better p95 / total ms is clearly lower and assignments stay sticky for a user id.

## Stretch (optional)

- Change the traffic split in the datafile and re-check the readout counts.
- Sketch where an edge worker would refresh the datafile on a timer.
