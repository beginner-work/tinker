# @tinker/context-model

Tinker is a **context model** of what a user understands: a concept graph
where each user-concept node carries a depth estimate and a confidence,
updated from fine-grained signals.

Claude (Anthropic, optionally via Vercel AI Gateway) handles language.
Jev (TypeSafe System One) handles typed scoring **only through Vercel AI
Gateway** (`typesafe-ai/jev`, evals pin `typesafe-ai/jev-1.14.0`):

- **Score** for depth level with probabilities
- **Noul** for "is this source just past the learner's depth"

Auth: `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`. Endpoint:
`POST https://ai-gateway.vercel.sh/typesafe/v1/systemone`.

See `docs/CONTEXT_MODEL.md` at the repo root.
