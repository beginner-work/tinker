# Stripe webhooks at scale (45 minutes)

## Goal

Inline webhook handling double-applies when Stripe retries. Your focused change: process events through an **idempotency ledger** so each Stripe `event.id` applies once under burst replay.

## Setup (pre-built)

```bash
docker compose up -d          # stripe-mock
npm install
export STRIPE_API_KEY=sk_test_123
# k6 optional: https://grafana.com/docs/k6/latest/set-up/install-k6/
```

## What to change (core)

1. Start `baseline/server.js` (inline apply on the request thread).
2. Run `npm run burst` and note `duplicates_applied > 0`.
3. Start `better/server.js` (accept + ledger). Re-run `BETTER=1 npm run burst`.
4. Confirm `duplicates_applied=0` and side effects equal unique events.
5. If stuck, diff baseline `applyEvent` against `better/queue/worker.js` ledger checks.

## How to verify

```bash
npm run baseline
npm run burst
npm run better
BETTER=1 npm run burst
npm run test:idempotency
```

Done when better burst replay prints `duplicates_applied=0`.

## Stretch (optional)

- Inspect retries and the **dead-letter queue** for `poison.test` events (`npm run test:idempotency`).
- Call `POST /v1/payment_intents` with `Idempotency-Key` (agent-safe create) against stripe-mock.
- Flood with `k6 run k6/load.js` and compare accept latency baseline versus better.
