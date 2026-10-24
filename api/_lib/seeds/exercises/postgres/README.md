# Scaling Postgres (45 minutes)

## Goal

A naive Postgres-backed endpoint falls over under k6. Your focused change: send traffic through **PgBouncer** (transaction pooling) and re-measure.

## Setup (pre-built)

```bash
docker compose up -d          # primary, replica, PgBouncer
npm install
npm run seed                  # flat + partitioned tables already scripted
# k6: https://grafana.com/docs/k6/latest/set-up/install-k6/
```

## What to change (core)

1. Start `baseline/server.js` (new connection per request, direct to primary).
2. Run `k6 run k6/load.js` and note failure rate / p95.
3. Start `better/api/server.js` (writes through PgBouncer). Confirm `/health` reports `write: "pgbouncer"`.
4. Re-run k6 with `TARGET=http://127.0.0.1:5402`.
5. If stuck, diff `baseline/server.js` against `better/api/server.js` and focus on how connections are acquired.

## How to verify

```bash
npm run baseline
TARGET=http://127.0.0.1:5401 k6 run k6/load.js --summary-export=k6-summary-baseline.json
npm run better
TARGET=http://127.0.0.1:5402 k6 run k6/load.js --summary-export=k6-summary-better.json
npm run compare
```

Done when better completes the same k6 script with fewer connection errors than baseline.

## Stretch (optional)

- Point reads at the **replica** (`REPLICA_URL`) and confirm `/health` shows `read: "replica"`.
- Query `events_part` and run `npm run partition-check` to see partition pruning.
- Tune PgBouncer `DEFAULT_POOL_SIZE` and re-run k6.
