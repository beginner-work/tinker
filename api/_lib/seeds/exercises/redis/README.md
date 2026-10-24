# Redis cache at scale (45 minutes)

## Goal

A slow Postgres-backed product endpoint has no cache. Your focused change: add **Redis cache-aside with a TTL** on reads and show k6 latency before versus after.

## Setup (pre-built)

```bash
docker compose up -d          # Postgres + Redis
npm install
npm run seed                  # 200 products; id=1 is the hot key
# k6: https://grafana.com/docs/k6/latest/set-up/install-k6/
```

## What to change (core)

1. Start `baseline/server.js` (every GET hits Postgres with delay).
2. Run `k6 run k6/load.js` and note `product_ms` p95.
3. Start `better/server.js` (Redis get/set with TTL). Confirm responses show `cache: "hit"` after warm-up.
4. Re-run k6 with `TARGET=http://127.0.0.1:5202`.
5. If stuck, diff baseline `loadProduct` against `better/cache.js` `get` / `set`.

## How to verify

```bash
npm run baseline
TARGET=http://127.0.0.1:5201 k6 run k6/load.js --summary-export=k6-summary-baseline.json
npm run better
TARGET=http://127.0.0.1:5202 HOT_ID=1 k6 run k6/load.js --summary-export=k6-summary-better.json
npm run compare
```

Done when better p95 drops sharply and `/health` shows cache hits.

## Stretch (optional)

- Prove **write invalidation**: `POST /products/1` then confirm the next GET refills from Postgres.
- Run `npm run stampede` for lock / singleflight protection on the hot key.
- Tune `ttlSeconds` and watch hit rate versus freshness after inventory updates.
