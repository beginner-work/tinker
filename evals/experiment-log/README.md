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
