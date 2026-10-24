# Scaling Postgres (45 minutes)

## Goal

Diff `baseline.js` (new fake DB connection per request) against `better.js` (shared pool). Under a concurrent fake load, the pool wins. No Docker Postgres.

## Setup

Nothing to install. Open this folder in the Tinker IDE.

## What to change

1. Read `baseline.js`. Each query opens and closes a connection; the fake server has a low `maxConnections`.
2. Read `better.js`. A small pool reuses connections.
3. Edit toward the pool shape.
4. Run the check.

## How to verify

```bash
node check.mjs
```

Done when better completes the concurrent batch with zero connection errors and lower wall time.

## Stretch (optional)

- Add a fake read-replica pool and route `SELECT`s there.
- Partition a fake `events` table by month and show that a ranged query only scans one partition list.
