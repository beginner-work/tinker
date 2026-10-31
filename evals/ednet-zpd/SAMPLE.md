# EdNet ZPD sample (fixed, seeded, cheap)

This benchmark does **not** commit EdNet data. Download it with:

```bash
node evals/ednet-zpd/download.js
```

Default cache directory: `evals/ednet-zpd/.cache/` (gitignored). KT3 prefers
a valid ~763MB zip (Google Drive fallback when the USTC mirror is truncated).
Contents (`questions.csv`) are required so responds get `correct` + skill tags.

## Reproducible sample + splits

| Field | Value |
| --- | --- |
| Sample seed | `42` (`EDNET_SAMPLE_SEED`) |
| Split seed | `42` (`EVAL_SPLIT_SEED`, same default) |
| Max users | `200` (`EDNET_SAMPLE_USERS`) |
| Max events per user (KT3) | `1500` (`EDNET_SAMPLE_EVENTS`) |
| Split ratios | train 60% / dev 20% / test 20% (by `userId::conceptId`) |
| Default eval split | **dev** (target: well above ~100 probes; typically ~1.4k) |
| Held-out test | `EVAL_SPLIT=test` or `--test` only |

v0 is the public baseline config (`evals/config/public-baseline/v0`). Tuned
instruction packs go in `evals/private-config/` (gitignored).

## Ground-truth ZPD bands

| Observation | Band |
| --- | --- |
| Correct unaided | `too_easy` |
| Wrong unaided, then correct after lecture/explanation | `in_zpd` |
| Still wrong after help | `too_hard` |

## Tinker depth → band mapping

Continuous Tinker depth is mapped to bands with **two cut points calibrated
on the train split only** (never on dev/test). Fixed `materialDepth=0.55` +
default margin collapses EdNet depths almost entirely to `too_hard` and must
not be used for band accuracy. Runs print the confusion matrix and
true/predicted band distributions.

## Metrics

- Primary: ZPD band **accuracy** and **macro-F1** (on the active split)
- Supporting: next-response **AUC** (uses continuous depth, not band cuts)
- Experiment log: version, dev score, optional test score, testEvalCount

## Baselines

1. **Claude-only** band classifier (versioned templates; AI Gateway
   `anthropic/claude-*` in Actions; local Anthropic key optional)
2. **Jev+Claude** v0 (no agent modeling): Jev Score via AI Gateway
   (`typesafe-ai/jev-1.14.0` when pinned) + Claude band with Jev features
3. **BKT** (classic; always runnable)
4. Offline: local **Tinker** heuristic + stretch **softmax on Jev probs**
