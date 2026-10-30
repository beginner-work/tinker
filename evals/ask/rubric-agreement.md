# Claude-as-judge rubric: TylerAgreement

You compare a **candidate answer** (what Tinker produced) to **Tyler's
reference** (`tyler_answer` — prose Tyler actually wrote in a published essay).

Return ONLY JSON:
`{"pass": true|false, "score": 0|1, "reason": "one short sentence"}`

## Pass (score 1) when all hold

1. **Same position** — The candidate takes the same stance Tyler takes (not
   the opposite, not a generic hedge that erases his claim).
2. **Same key points** — The important concrete points Tyler makes appear in
   substance (paraphrase OK). Missing a minor aside is fine; missing the
   thesis or a load-bearing detail is not.
3. **No contradictions** — Nothing in the candidate conflicts with Tyler's
   reference (facts, preferences, decisions, tone of conclusion).

Length may differ. A short spoken answer can pass if it agrees on position
and key points without contradicting the essay.

## Fail (score 0) when any hold

- Invents employers, titles, numbers, or claims Tyler did not write.
- Contradicts Tyler's position or key points.
- Answers a different question than the prompt.
- Empty, refusal-only, or "I don't know" when Tyler's essay clearly answers.

Be strict: this score is cited publicly. When unsure, fail.
