# Scaling agents (45 minutes)

## Goal

A Vercel AI SDK + MCP agent handles one request at a time. Your focused change: run agent work on a **concurrent job queue** and re-measure under k6.

## Setup (pre-built)

```bash
npm install
# Optional: ANTHROPIC_API_KEY=... (otherwise a deterministic stub model is used)
# MCP server: better/mcp-server ( @modelcontextprotocol/sdk )
# k6: https://grafana.com/docs/k6/latest/set-up/install-k6/
```

## What to change (core)

1. Start `baseline/server.js` (global mutex; serial `/agent`).
2. Run `k6 run k6/load.js` and note `agent_wait_ms`.
3. Start `better/server.js` (queue with concurrency). Confirm `/health` shows queue stats.
4. Re-run k6 with `TARGET=http://127.0.0.1:3082`.
5. If stuck, diff the baseline mutex against `better/queue/worker.js` `enqueue`.

## How to verify

```bash
npm run baseline
TARGET=http://127.0.0.1:3081 k6 run k6/load.js --summary-export=k6-summary-baseline.json
npm run better
TARGET=http://127.0.0.1:3082 k6 run k6/load.js --summary-export=k6-summary-better.json
npm run compare
```

Done when better wait times stay bounded while baseline climbs with concurrency.

## Stretch (optional)

- Turn on response caching in the queue (`cacheTtlMs`) and watch `cacheHits` under repeated prompts.
- Tighten `minIntervalMs` rate limiting and observe throughput versus errors.
- Run `npm run evals` and compare serial versus parallel eval wall time.
