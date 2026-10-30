# Ask / Tyler-voice eval dataset schema (Braintrust project `tinker-ask`)

Each case is one JSON object (one file under `evals/ask/dataset/cases/` or one
row in `evals/ask/dataset/cases.jsonl`).

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | string | yes | Stable id, e.g. `essay-e_abc-p03` |
| `question` | string | yes | The prompt / visitor question (eval input) |
| `source` | `"essay"` \| `"synthetic"` \| `"visitor"` \| `"linkedin"` | yes | Provenance |
| `tyler_answer` | string \| `null` | yes | Tyler's reference answer. **Null** until a human (or promote flow) attaches one — schema is ready for that UI; this PR does not build the UI. |
| `essayId` | string \| null | no | Present when `source=essay` |
| `essayTitle` | string \| null | no | Display title at snapshot time |
| `promptIndex` | number \| null | no | 0-based index of the `>` writing prompt inside the essay body |
| `category` | string | yes | `agreement` \| `grounded` \| `refusal` \| `off_topic` \| `prompt_injection` \| `voice_messy` |
| `input` | `"typed"` \| `"voice"` | no | Defaults to `typed` |
| `rawTranscript` | string | no | Voice-messy raw ASR text |
| `expect` | object | no | Deterministic checks (keywords, sentence budget, forbidden strings) |
| `notes` | string | no | Hand-check hint for reviewers |

## Source meanings

- **essay** — Writing prompt extracted from a published Founder Source /
  Development essay (`TinkerUserData` kind `essays`). `question` is a `>`
  blockquote session prompt (or a title/opening fallback). `tyler_answer` is
  Tyler's prose from that essay (question markers stripped).
- **synthetic** — Hand-authored for grounding / refusal / drift / injection.
  May set `tyler_answer` later when Tyler writes a gold answer.
- **visitor** — Real `/api/ask` log (or recruiter question). Promoted via
  `npm run eval:ask:promote`. Starts with `tyler_answer: null`.
- **linkedin** — Paired from LinkedIn's official `messages.csv` export
  (inbound message → Tyler Lindow's next reply). Incoming text is rewritten
  into a generic question (names / other-person companies / URLs stripped);
  `tyler_answer` is Tyler's reply. Loaded via
  `npm run eval:ask:linkedin` into a **private** Braintrust dataset
  (`linkedin-replies-private`). **Never commit real export files**; only the
  synthetic fixture under `evals/ask/fixtures/` is in-repo.

## Core metric

**How often Tinker answers the way Tyler would** → Braintrust score
`TylerAgreement` (Claude-as-judge vs `tyler_answer`). Cases with
`tyler_answer: null` skip that scorer and only run applicable
grounding/refusal/drift checks.
