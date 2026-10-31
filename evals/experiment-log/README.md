# Experiment log

Each iteration of the baseline loop appends one JSON line to
`experiments.jsonl`:

| Field | Meaning |
| --- | --- |
| `version` | Config pack id (`v0`, `v1`, …) |
| `benchmark` | `ednet-zpd` or `source-zpd` |
| `split` | `dev` (default) or `test` (rare) |
| `devScore` | Metrics from the iteration-facing split |
| `testScore` | Set only when a held-out test run was executed |
| `testEvalCount` | Running count of test-split evaluations |

`test-eval-count.json` mirrors the count. **Do not** evaluate test during
normal tuning. Use `EVAL_SPLIT=test` or `--test` deliberately.

Train is for fitting optional downstream models only; the loop reads **dev**.

## CI regression gate

`.github/workflows/context-model-eval.yml` fails when **dev-split** EdNet ZPD
band **accuracy** or **macro-F1** for a comparable system (`tinker`, `bkt`,
and keyed `claude` / `jevClaude` when present) drops more than the absolute
tolerance below the last recorded `devScore` in this file.

| Knob | Default | Meaning |
| --- | --- | --- |
| `EVAL_BASELINE_TOLERANCE` | `0.02` | Allowed absolute drop on [0,1] scores (2 percentage points) |

Implementation: `evals/lib/check-baseline-regression.js`. CI snapshots this
log **before** the run so the gate compares against the committed baseline,
not the line just appended.

Push to `main` always runs the offline eval (and keyed when secrets exist)
and appends a new log line in the job workspace; merge PRs that update
`experiments.jsonl` to persist a new recorded baseline in git.
