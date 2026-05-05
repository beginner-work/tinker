# product-spec skill — evals

Lightweight harness that runs the `product-spec` skill against a set of
synthetic users and asserts properties of the resulting `product-spec.md`.

The eval is **single-shot**: each case packages the skill content plus a
simulated user's answers to every Phase 1 + Phase 2 question, sends it to
Claude in one API call, captures the generated spec, and checks assertions
against it. This is faster and more deterministic than replaying a multi-turn
conversation, at the cost of not exercising the conversational flow itself.

## Run

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
npm run eval:product-spec
```

Optional env vars:

| Var | Effect |
|---|---|
| `EVAL_MODEL` | Override the model. Default: `claude-sonnet-4-6`. |
| `EVAL_CASE` | Run only cases whose filename starts with this prefix (e.g. `EVAL_CASE=01`). |
| `EVAL_DUMP_FAILURES=1` | After the run, print the full generated spec for any failed case. |

Exit code is `0` if all assertions pass, `1` if any fail, `2` for setup
errors.

## Structure

```
evals/
├── run-evals.mjs          # the harness
├── cases/
│   ├── 01-existing-shell-writer.json
│   ├── 02-content-principle-publisher.json
│   └── 03-one-and-done-namer.json
└── README.md
```

Each case file is a JSON object with:

- `name` — human-readable label.
- `user_idea` — the one-paragraph product idea the simulated user is bringing.
- `platform_target` — the answer to the Phase 1 prelude.
- `phase1` — answers to the five foundation questions.
- `phase2` — answers to the seven narrowing questions plus the always-ask
  follow-up to Q2.
- `context_files` (optional) — names of files in `evals/fixtures/` to include
  as if they existed in the working directory (e.g. a fake `README.md`).
- `assertions` — array of structural and content checks to run against the
  generated spec.

## Assertion types

| Type | Meaning |
|---|---|
| `contains` | Spec must contain the literal substring (case-sensitive). |
| `contains_ci` | Spec must contain the substring (case-insensitive). |
| `not_contains` | Spec must NOT contain the substring (case-sensitive). |
| `not_contains_ci` | Spec must NOT contain the substring (case-insensitive). |
| `regex` | Spec must match the regex (with optional `flags`). |
| `regex_no_match` | Spec must NOT match the regex. |
| `any_of` | Spec must contain at least one of `values` (case-insensitive). |

## What each case is testing

- **01 — existing-shell-writer.** The product lives inside an existing
  Electron + Capacitor browser. Tests: structural inheritance (section 4
  references `src/renderer/`, sidebar/tabs/welcome page); UI-shape
  specificity (section 7 says "onboarding flow"); UI-shape anti-pattern
  ("not a chat"); allowlist for "no AI-written words"; jargon absence.
- **02 — content-principle-publisher.** Greenfield publishing tool with
  a strict "no AI-written words" rule and a wizard UI. Tests: the
  Visible-string allowlist subsection appears in section 9; section 7
  names "wizard"; jargon absence.
- **03 — one-and-done-namer.** A truly one-and-done tool with no return
  loop. The user picks "Nothing yet" for visual canon, which should
  produce at least one `[NEEDS INPUT]` placeholder. Tests: section 8
  honestly states no loop; spec does not fabricate recurring usage; spec
  contains a `[NEEDS INPUT]`; jargon absence.

## Adding a case

1. Create a new file under `cases/` named `NN-short-slug.json`. Number
   it after the highest existing.
2. Fill in `user_idea`, `platform_target`, `phase1`, `phase2`, and
   `assertions`. Mirror the shape of an existing case.
3. Run `EVAL_CASE=NN npm run eval:product-spec` to test the new case
   in isolation.

## Limitations

- Single-shot prompting doesn't exercise the conversational flow, the
  AskUserQuestion tool, or `[NEEDS INPUT]`-driven mid-session pauses.
- LLM output is non-deterministic; assertions should be tolerant of
  surface variation (prefer `any_of` over a strict `contains` when the
  exact phrasing isn't fixed).
- The harness costs API tokens per run. Use `EVAL_CASE=NN` to iterate
  on a single case while debugging.
