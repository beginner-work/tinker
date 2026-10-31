# @tinker/context-model

Tinker is a **context model** of what a user understands: a concept graph
where each user-concept node carries a depth estimate and a confidence,
updated from fine-grained signals.

Claude (Anthropic) handles language. Jev (TypeSafe System One, via
OpenRouter `typesafe/jev-latest` or `POST /v1/systemone` at TypeSafe)
handles typed scoring:

- **Score** for depth level with probabilities
- **Noul** for "is this source just past the learner's depth"

See `docs/CONTEXT_MODEL.md` at the repo root.
