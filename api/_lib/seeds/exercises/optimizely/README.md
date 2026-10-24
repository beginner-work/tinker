# Optimizely at the edge (45 minutes)

## Goal

Per-request network flag decisions are slow under load. Your focused change: evaluate flags from a **local Optimizely datafile** (edge-friendly) and compare k6 latency.

## Setup (pre-built)

```bash
npm install
# Datafile stub: lib/datafile.json (no Optimizely account)
# k6: https://grafana.com/docs/k6/latest/set-up/install-k6/
```

## What to change (core)

1. Start `baseline/server.js` (HTTP hop to a stub CDN on every `/decide`).
2. Run `k6 run k6/load.js` and note `decide_ms` p95.
3. Start `better/server.js` (`@optimizely/optimizely-sdk` + local datafile).
4. Re-run k6 with `TARGET=http://127.0.0.1:3072`.
5. If stuck, diff how `better/server.js` calls `createInstance` / `decide` versus the baseline `fetch`.

## How to verify

```bash
npm run baseline
TARGET=http://127.0.0.1:3071 k6 run k6/load.js --summary-export=k6-summary-baseline.json
npm run better
TARGET=http://127.0.0.1:3072 k6 run k6/load.js --summary-export=k6-summary-better.json
npm run compare
npm run readout
```

Done when better p95 is clearly lower and responses show `source: "local_datafile"`.

## Stretch (optional)

- Change traffic split in `lib/datafile.json` and confirm `npm run readout` moves.
- Track `onboarding_completed` from the SDK and sketch where an edge worker would refresh the datafile.
- Lower `CDN_DELAY_MS` on baseline and see how close network decide can get (spoiler: still a hop).
