# Spec: Payments REST API (Fastify + TypeScript)

Build a small payments-domain API using the words a payments team says out loud:
**merchant**, **payment**, **refund**, **amountCents**, **currency**.

Ties to Eric Evans, *Domain-Driven Design*, Chapter 2 (Communication and the Use of Language).
Complements the API design practice track. Prefer fintech ubiquitous language over
metaphors from other domains.

## Resources

### Payment

| Field | Type | Rules |
| --- | --- | --- |
| `paymentId` | string | Server-generated; present on responses |
| `merchantId` | string | Required on create; non-empty |
| `amountCents` | number | Required on create; integer > 0 |
| `currency` | string | Required on create; lowercase ISO code, e.g. `usd` |
| `status` | string | Server-set: `pending` on create; `refunded` after a full refund |
| `createdAt` | string | ISO-8601; set by server |

### Refund

| Field | Type | Rules |
| --- | --- | --- |
| `refundId` | string | Server-generated |
| `paymentId` | string | The payment being refunded |
| `amountCents` | number | Required; integer > 0; must not exceed the payment's `amountCents` |
| `createdAt` | string | ISO-8601; set by server |

In-memory store is fine. No database. No Stripe network calls.

## Routes

| Method | Path | Success | Notes |
| --- | --- | --- | --- |
| `POST` | `/payments` | `201` | Body: `{ merchantId, amountCents, currency }`. Return the created payment. |
| `GET` | `/payments` | `200` | Optional `?merchantId=` filter. Return `{ payments: Payment[] }`. |
| `GET` | `/payments/:paymentId` | `200` | Return one payment. |
| `POST` | `/payments/:paymentId/refunds` | `201` | Body: `{ amountCents }`. Return the created refund. Mark the payment `refunded` when refunded in full. |
| `GET` | `/refunds/:refundId` | `200` | Return one refund. |

## Validation and status codes

- Missing/empty required fields, non-integer or non-positive `amountCents`, or unknown `currency` shape → `400` with `{ error: string }`.
- Refund `amountCents` greater than the payment's `amountCents` → `400` with `{ error: string }`.
- Unknown `paymentId` or `refundId` → `404` with `{ error: string }`.
- Content-Type for JSON requests/responses: `application/json`.

## What you implement

Open `src/payments.ts` and fill in the handlers. Route wiring and the Fastify app factory are already set up in `src/app.ts` / `src/server.ts`. Leave the store in memory.

## Language drift (DDD Ch 2)

Before you name a route or type, ask: would a payments teammate say this word in standup?
If spoken language says **refund** but the code says `credit`, `reversal`, or `chargeback`, that is drift. Keep the code names aligned with the spoken domain.

## How to run

```bash
cd exercises/api-design
npm install
npm test
```

Tests start red. Implement until both the happy-path and the 400 validation test pass (plus any others you add).
