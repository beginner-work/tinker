# Library study session exercises

Each module is a **45-minute** baseline-to-better scale drill. Docker Compose, seed data, and the better solution are pre-built so you spend the block on one focused change. Extra depth lives in each README's **Stretch** section.

| Folder | Stack | 45-minute focus |
| --- | --- | --- |
| `postgres` | Postgres | Survive k6 via PgBouncer pooling |
| `optimizely` | Optimizely | Local datafile eval instead of a network decide |
| `vercel-ai-mcp` | Vercel AI SDK + MCP | Concurrent job queue instead of one-at-a-time |
| `prometheus-grafana` | Prometheus + Grafana | Drop high-cardinality labels under k6 |
| `stripe` | Stripe test mode | Idempotent webhook processing under burst replay |
| `redis` | Redis + Postgres | Cache-aside with TTL on a hot key |

Conventions: `README.md`, `baseline/`, `better/`, scripts, and `k6/` where load testing applies.

```bash
node scripts/pack-exercise-seeds.mjs
```
