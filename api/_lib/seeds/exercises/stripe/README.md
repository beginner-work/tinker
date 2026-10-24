# Stripe webhooks at scale (45 minutes)

## Goal

Diff `baseline.js` (inline webhook apply) against `better.js` (idempotency ledger, retries, dead-letter queue). Prove burst replay does not double-apply. Fake Stripe events only. No Stripe account, CLI, or stripe-mock.

## Setup

Nothing to install. Open this folder in the Tinker IDE.

## What to change

1. Read `baseline.js`. Replays call `apply` again for the same `event.id`.
2. Read `better.js`. Note the ledger, retry count, and DLQ for poison messages.
3. Edit toward the better shape so each event id applies once.
4. Run the check.

## How to verify

```bash
node check.mjs
```

Done when the check prints `pass`, `duplicates_applied=0` for better, and a poison event lands in the DLQ.

## Stretch (optional)

- Add an agent-safe `createPaymentIntent({ idempotencyKey })` helper that rejects missing keys.
- Tune `maxAttempts` and confirm poison messages reach the DLQ only after retries.
- Emit a short timeline log of accept / apply / duplicate / dlq for one burst.
