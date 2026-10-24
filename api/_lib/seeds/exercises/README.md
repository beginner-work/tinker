# Library study session exercises

Tinker IDE format: each module is **one `baseline.js`**, **one `better.js`**, a short `README.md`, and `check.mjs` that proves the better file wins. Everything runs in-process with Node. No Docker, k6, cloud accounts, or API keys.

| Folder | 45-minute focus |
| --- | --- |
| `vercel-ai-mcp` | Concurrent agent queue vs one-at-a-time |
| `stripe` | Idempotent webhooks vs double-apply on replay |
| `postgres` | Connection pool vs connect-per-request |
| `optimizely` | Local flag decide vs fake network hop |
| `prometheus-grafana` | Bounded metric labels vs high cardinality |
| `redis` | Cache-aside TTL vs uncached slow reads |

Open the module in Tinker, diff `baseline.js` against `better.js`, edit toward the better shape, then run:

```bash
node check.mjs
```

Rebuild packed seeds after edits: `node scripts/pack-exercise-seeds.mjs`
