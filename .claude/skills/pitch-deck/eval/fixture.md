# pitch-deck eval — fixture

This documents the canonical session that produced the reference pitch
(beginner — the $300K San-Diego-then-San-Francisco seed). The eval
(`eval.sh`) asserts that any `pitch-deck.md` derived from these inputs
contains the content fingerprints below, and contains none of the
banned phrases the skill warns against.

The fixture is the source of truth for the eval. If the canonical
session changes, update this file first, then update `eval.sh`'s
`MUST_APPEAR` and `MUST_NOT_APPEAR` arrays to match.

---

## Phase 1 answers (the five broad questions)

| Question | Answer |
|---|---|
| **Salary, take-home, no funny math** | $300K |
| **What you stand for** | Every founder is fully funded to do what they do best, on terms they can hold. |
| **Brand spirit — the room after they walk in** | Anointed — chosen-one-for-their-craft. Voice is the moat. |
| **Brand palette** | Pastel rainbow as a statement of joy and tropical heritage (not pride). |
| **What business you're in** | Founder tech — an AI-native vertical platform that turns conviction into a page seeders read. |
| **How far you'd go** | Down to one month of personal runway. |

## Phase 2 answers (branched follow-ups)

| Beat | Answer |
|---|---|
| **Audience persona** | Bauer the barber — sees a client every 30 minutes, knows what's broken about gigwork from inside the chair. |
| **Audience at large** | Those who seek to further their worldview and stand strong in protecting indigenous culture. |
| **Conviction moment for the audience** | They watch products get seeded into the platform — money moves openly, in front of them. |
| **Mechanism** | The page describes the founder for *seeders*, not buyers. Pricing makes time visible; support that doesn't extract hours; structural no for everything off-page. |
| **Line in the sand** | Founder runway is one month; if the seed doesn't close in 30 days, founder steps away. |

---

## Content fingerprints — asserted by `eval.sh`

The deck **must** contain (proves the founder's actual answers landed,
not a generic VC template):

- `$300K` — the ask and the take-home target
- `one month` — the line-in-the-sand runway figure
- `San Diego` — the Year-1 beachhead
- `San Francisco` — the Year-1 second city
- `Filipino` — heritage marker on the audience side
- `barber` — the named seeder persona
- `Enterprise` — the high-LTV accelerator tier
- `beginner` — the product name
- `AI-native` — the business framing
- `## 1. The problem` — slide-1 heading shape
- `The line in the sand` — closing-slide title

The deck **must not** contain (jargon banned by the skill, or the
fabricated-citation patterns the skill explicitly warns against):

- `synergy`
- `go-to-market`
- `disrupt` (any form)
- `leverage` as a verb
- `(Pew, 2023)` — sample fake-citation pattern
- `tens of millions globally` — vague TAM phrasing
- `$Xbn` — un-derived market-size shorthand
- `massive market`

---

## Running the eval

```sh
cd /path/to/working/dir/with/pitch-deck.md
bash /home/user/web/.claude/skills/pitch-deck/eval/eval.sh
```

Or pass an explicit path:

```sh
bash /home/user/web/.claude/skills/pitch-deck/eval/eval.sh /home/user/pitch-deck.md
```

The script exits 0 on pass, non-zero on any failed assertion, and
prints each missing/forbidden string on its own line.
