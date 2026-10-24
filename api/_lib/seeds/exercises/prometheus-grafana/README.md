# Prometheus + Grafana under load (45 minutes)

## Goal

k6 plus unbounded metric labels explode series count. Your focused change: emit **bounded labels** (route template + status) and confirm series stay flat under the same load.

## Setup (pre-built)

```bash
docker compose up -d          # Prometheus (baseline + better) and Grafana
npm install
# k6: https://grafana.com/docs/k6/latest/set-up/install-k6/
# Grafana: http://127.0.0.1:3000 (admin/admin)
```

## What to change (core)

1. Start `baseline/app/server.js` (labels every request with raw `user_id` + full path).
2. Run `k6 run k6/load.js` and watch `series` climb in responses / `/health`.
3. Start `better/app/server.js` (labels only `route` + `status`).
4. Re-run k6 with `TARGET=http://127.0.0.1:5092`.
5. If stuck, diff how each app builds `http_requests_total` labels.

## How to verify

```bash
npm run baseline
TARGET=http://127.0.0.1:5091 k6 run k6/load.js --summary-export=k6-summary-baseline.json
npm run better
TARGET=http://127.0.0.1:5092 k6 run k6/load.js --summary-export=k6-summary-better.json
npm run compare
```

Done when better `app_series_count` stays small and flat while baseline grows with unique user ids.

## Stretch (optional)

- Open Grafana and graph `job:http_success:ratio_rate5m` from `better/alerts/burn-rate.yml` recording rules.
- Run `npm run incident` and confirm a burn signal; read `better/runbook.md`.
- Wire Alertmanager (not bundled) to page on `CheckoutErrorBudgetBurnFast`.
