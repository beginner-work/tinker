# Eval config (versioned Jev + Claude instructions)

v0 is a **public baseline**: Jev + Claude only, no agent modeling. Tuned
iterations live in a **private** config directory so the harness and results
can stay public.

## Lookup order

1. `$TINKER_EVAL_CONFIG_DIR/<version>/`
2. `evals/private-config/<version>/` (gitignored)
3. For `v0` only: `evals/config/public-baseline/v0/` (committed baseline)

Set `TINKER_EVAL_CONFIG_VERSION` (default `v0`) or pass `--version`.

## Layout per version

```
<version>/
  manifest.json           # version, notes, file map
  jev-depth-score.json    # Score: depth levels
  jev-source-noul.json    # Noul: source just past depth
  claude-zpd-band.json    # Claude band classifier system/user templates
  claude-source-pick.json # Claude source-pick templates
```

See `schema.md` for field shapes. The loader validates at runtime.

## Private path

```bash
mkdir -p evals/private-config/v1
cp -R evals/config/public-baseline/v0/* evals/private-config/v1/
# edit instructions/criteria, then:
TINKER_EVAL_CONFIG_VERSION=v1 npm run eval:ednet-zpd
```

Or point `TINKER_EVAL_CONFIG_DIR` at a directory outside the repo.

Never commit tuned instructions. The baseline under `public-baseline/v0` is
the intentional starting point for the iteration loop.
