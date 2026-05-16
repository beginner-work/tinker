# product-spec skill — evals

Lightweight harness that runs the `product-spec` skill against a set of
synthetic users and asserts properties of the resulting `build-prompt.md`.

The eval is **single-shot**: each case packages the skill content plus a
simulated user's answers to every Phase 1 + Phase 2 question, sends it to
Claude in one API call, captures the generated build prompt, and checks
assertions against it. This is faster and more deterministic than replaying
a multi-turn conversation, at the cost of not exercising the conversational
flow itself.

The skill produces `build-prompt.md` as its canonical, versioned output.
The descriptive 13-section spec is internal scaffolding — these evals do
not check for `product-spec.md` because the skill no longer writes one by
default.

## Run

Two providers are supported. The harness prefers `GITHUB_TOKEN` (used by CI)
and falls back to `ANTHROPIC_API_KEY` (used for local dev).

```bash
# Local dev (Claude):
export ANTHROPIC_API_KEY="sk-ant-..."
npm run eval:product-spec

# Local dev mimicking CI (GitHub Models / GPT-4o):
export GITHUB_TOKEN="ghp_..."   # PAT with models:read scope
npm run eval:product-spec
```

In CI the `GITHUB_TOKEN` is auto-provisioned by Actions; the workflow grants
it `models: read` so it can call the GitHub Models inference endpoint. No
repo secret needs to be configured.

Optional env vars:

| Var | Effect |
|---|---|
| `EVAL_MODEL` | Override the model. Default: `openai/gpt-4o` (GitHub Models) or `claude-sonnet-4-6` (Anthropic). |
| `EVAL_CASE` | Run only cases whose filename starts with this prefix (e.g. `EVAL_CASE=01`). |
| `EVAL_DUMP_FAILURES=1` | After the run, print the full generated build prompt for any failed case. |

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
  generated build prompt.

## Assertion types

| Type | Meaning |
|---|---|
| `contains` | Build prompt must contain the literal substring (case-sensitive). |
| `contains_ci` | Build prompt must contain the substring (case-insensitive). |
| `not_contains` | Build prompt must NOT contain the substring (case-sensitive). |
| `not_contains_ci` | Build prompt must NOT contain the substring (case-insensitive). |
| `regex` | Build prompt must match the regex (with optional `flags`). |
| `regex_no_match` | Build prompt must NOT match the regex. |
| `any_of` | Build prompt must contain at least one of `values` (case-insensitive). |

## What each case is testing

- **01 — existing-shell-writer.** The product lives inside an existing
  Electron + Capacitor browser. Tests: build prompt starts at `v0.100`;
  Read first / Constraints reference `src/renderer/` paths and structural
  primitives (sidebar / tabs / welcome page); UI-shape constraint says
  "onboarding flow"; Anti-patterns section says "not a chat" in negative
  form; allowlist constraint included; phase plan branches on
  "all-from-one-codebase" → web/PWA Phase 1 + native Phase 2; jargon
  absence.
- **02 — content-principle-publisher.** Greenfield publishing tool with
  a strict "no AI-written words" rule and a wizard UI. Tests: visible-
  string allowlist appears in Constraints; allowlist references verbatim
  user content; UI shape "wizard" named in Constraints; Anti-patterns
  say "not a chat"; phase plan = single-phase web (no native phasing);
  jargon absence.
- **03 — one-and-done-namer.** A truly one-and-done tool with no return
  loop. The user picks "Nothing yet" for visual canon, which should
  produce at least one `[NEEDS INPUT]` placeholder. Tests: build prompt
  honestly states no loop; doesn't fabricate recurring usage; contains
  `[NEEDS INPUT]`; jargon absence.

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
- The version-increment mechanic isn't tested here (the harness assumes
  no prior `build-prompt.md`, so every run produces `v0.100`). Test the
  increment behavior manually by running the skill twice in a real
  session.
