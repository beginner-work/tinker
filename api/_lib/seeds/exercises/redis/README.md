# Redis cache at scale (45 minutes)

## Goal

Diff `baseline.js` (slow fake DB on every read) against `better.js` (cache-aside with TTL). Prove the hot key gets faster. In-memory fake Redis and DB only.

## Setup

Nothing to install. Open this folder in the Tinker IDE.

## What to change

1. Read `baseline.js`. Every `getProduct` pays the DB delay.
2. Read `better.js`. Cache-aside with TTL; hits skip the DB.
3. Edit toward cache-aside.
4. Run the check.

## How to verify

```bash
node check.mjs
```

Done when better finishes the hot-key batch faster and reports cache hits.

## Stretch (optional)

- Invalidate on write and confirm the next read refills.
- Add singleflight / lock so concurrent misses on a hot key only fill once.
