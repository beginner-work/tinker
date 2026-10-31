# Tinker context model

Tinker is **not an LLM**. It is a context model of what a user understands:
a graph of concepts where each user-concept node carries a **depth** estimate
and a **confidence**, updated from fine-grained signals.

Claude (Anthropic API, optionally via Vercel AI Gateway) handles language.
**Jev** (TypeSafe System One) handles typed scoring, called **only** through
Vercel AI Gateway:

- **Score** for depth level with per-level probabilities
- **Noul** for "is this source just past the learner's depth"

Jev model id: `typesafe-ai/jev` (evals pin `typesafe-ai/jev-1.14.0` via
`JEV_EVAL_PIN=1` / `JEV_MODEL`). Endpoint:
`POST https://ai-gateway.vercel.sh/typesafe/v1/systemone`. Auth:
`AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`. Docs:
[AI Gateway TypeSafe](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe),
[docs.typesafe.ai](https://docs.typesafe.ai).

Headline product metric: accuracy at placing each concept in the learner's
zone of proximal development (`too_easy` / `in_zpd` / `too_hard`). Benchmarks
are the proxy for that assessment. Goal numbers stay out of public files until
real keyed runs exist.

## v0 baseline (iteration loop)

v0 is a **baseline**, not a finished agent: **Jev + Claude only**, with
**no agent modeling**. The harness is built so you can iterate on versioned
instructions while keeping results comparable.

| Rule | Detail |
| --- | --- |
| Splits | Every benchmark is `train` / `dev` / held-out `test` with fixed seed (`EVAL_SPLIT_SEED`, default `42`) |
| Iteration | Read **dev** only when tuning |
| Test | Run rarely (`EVAL_SPLIT=test` or `--test`); each test run increments `evals/experiment-log/test-eval-count.json` |
| Config | Jev questions + Claude templates are versioned JSON loaded at runtime |
| Privacy | Tuned packs live in `evals/private-config/` (gitignored) or `$TINKER_EVAL_CONFIG_DIR`; public `v0` baseline is committed under `evals/config/public-baseline/v0/` |
| Log | `evals/experiment-log/experiments.jsonl` records version, dev score, optional test score, testEvalCount |

See `evals/config/README.md` and `evals/experiment-log/README.md`.

## Architecture

```
signals (honest statement, reading, ask, skip, response, …)
        │
        ▼
┌───────────────────────┐     optional Jev Score via AI Gateway
│  @tinker/context-model │◄──── depth levels + confidence
│  updateBelief / graph  │
└───────────┬───────────┘
            │
            ▼
   UserConceptBelief (Prisma)
            │
            ▼
   classifyZpdBand / recommendSources
            │
            ├── optional Jev Noul (AI Gateway)
            └── GET /api/context-model  (user-visible inferences)
```

### Package

`packages/context-model` holds pure logic: schema, signals, update, ZPD,
Jev client (AI Gateway), recommend.

### Persistence

Prisma: `Concept`, `ConceptEdge`, `UserConceptBelief`, `ContextSignal`.

### HTTP

- `GET /api/context-model`: read inferred beliefs, graph, recent signals
- `POST /api/context-model?action=signal`: ingest signals
- `POST /api/context-model?action=concept`: upsert a concept

Auth: signed-in Stytch session. Users can always see what was inferred.

## Benchmarks

### EdNet ZPD (`evals/ednet-zpd`)

```bash
node evals/ednet-zpd/download.js   # KT1+KT3 (+ optional --kt4); not committed
npm run eval:ednet-zpd             # default: dev split, v0 baseline
EVAL_SPLIT=test npm run eval:ednet-zpd:test   # rare held-out
```

Fixed sample: seed `42`, 40 users, 400 events/user (`SAMPLE.md`). Synthetic
fixture used when cache is empty.

Ground truth: correct unaided → `too_easy`; wrong then correct after
lecture/explanation → `in_zpd`; still wrong after help → `too_hard`.

Baselines: Claude-only band (keyed), **Jev+Claude** v0 (no agent modeling;
keyed via AI Gateway), BKT (always). Offline also reports local Tinker
heuristic + stretch softmax-on-Jev-probs.

### Source ZPD (`evals/source-zpd`) (INTERNAL)

Fixed authored cases + hidden key. Hit rate for Claude-only vs Tinker,
including multi-session growth. Same split / config / experiment-log rules.

```bash
npm run eval:source-zpd
```

## Reproduce / CI

Without keys (must pass):

```bash
npm test --prefix packages/context-model
npm test
npm run eval:ednet-zpd
npm run eval:source-zpd
```

Optional secrets (GitHub Actions + local): `AI_GATEWAY_API_KEY` (required for
Jev; also routes Claude), `ANTHROPIC_API_KEY` (Claude direct fallback),
`BRAINTRUST_API_KEY`. On Vercel deploys, `VERCEL_OIDC_TOKEN` can replace the
gateway API key. Mirror from Vercel **Production** only - never Preview.

Workflow: `.github/workflows/context-model-eval.yml`.

- Unit job must pass before offline/keyed evals (`needs`)
- Offline EdNet/source always run; keyed runs on every `main` push, and on
  PRs only when `packages/context-model/`, `evals/`, `api/context-model*`,
  `prisma/schema.prisma`, or the workflow file change
- Dev-split ZPD band accuracy / macro-F1 must not drop more than
  `EVAL_BASELINE_TOLERANCE` (default `0.02`) below the last recorded line in
  `evals/experiment-log/experiments.jsonl`

## Results policy

Measured numbers come only from real runs. Do not invent accuracy, F1, AUC,
or hit-rate figures in public docs. Keep numeric goals in `DO_NOT_PUBLISH*`
if needed.
