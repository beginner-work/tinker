# Scaling agents (45 minutes)

## Goal

Diff `baseline.js` (one agent request at a time) against `better.js` (job queue + concurrency). Make the better shape win under a fake concurrent load. Stub LLM and MCP tools only. No API keys.

## Setup

Nothing to install. Open this folder in the Tinker IDE.

## What to change

1. Read `baseline.js`. Note the mutex: each `/agent`-style call waits for the previous one.
2. Read `better.js`. Note `enqueue` with a concurrency limit, plus response cache and parallel evals.
3. Edit until you understand the queue. Use the better file as the target shape.
4. Run the check.

## How to verify

```bash
node check.mjs
```

Done when the check prints `pass` and better finishes the concurrent batch faster than baseline, with evals asserting correct tool choice.

## Stretch (optional)

- Tighten rate limiting (`minIntervalMs`) and watch throughput in the check output.
- Raise cache TTL and confirm repeated prompts become cache hits.
- Add another eval case that fails if `search_docs` is chosen for an `ord_` prompt.
