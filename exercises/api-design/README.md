# Fastify payments API (DDD Ch 2)

Hands-on module: build a small **Fastify + TypeScript** REST API for a payments
domain (**merchant**, **payment**, **refund**) with validation and correct HTTP
status codes.

Pairs with Eric Evans, *Domain-Driven Design*, Chapter 2 (Communication and the
Use of Language). Complements the API design practice track.

Use the fintech ubiquitous language in routes, types, and tests. Do not borrow
analogies from unrelated domains.

## Start here

1. Read [SPEC.md](./SPEC.md).
2. `npm install`
3. `npm test` (expect failures until you implement handlers).
4. Edit `src/payments.ts` - the handler bodies are stubs on purpose.
5. Re-run `npm test` until green.

Hint while you code: when a teammate says "issue a refund," do your route and
type say `refund`, or did the name drift to something else?

Optional: `npm run dev` starts the server on port `3030` for manual curls.
