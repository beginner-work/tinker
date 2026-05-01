---
name: content-harness
description: Draft branded long-form content shaped for a specific audience. Runs a structured AskUserQuestion intake covering brand voice and audience profile before writing anything. Use when the user asks for a pitch deck, sales narrative, board update, or other branded narrative where company voice and reader tailoring both matter. Currently specialized for investor pitch decks; the brand-intake step is reusable for future content types.
---

# Content Harness

Branded content drafted from a structured intake. The intake is the point of this skill — never generate the content from sparse instructions. Always drive the intake through the `AskUserQuestion` tool so the user sees the choice space rather than free-typing.

## Supported content types

- **Investor pitch deck** — first and currently only supported type.

If the user asks for something else (one-pager, blog post, sales email, etc.), tell them this skill is currently pitch-deck-only and ask whether they want to proceed with a deck or skip the skill.

## Workflow

### 1. Confirm scope

If the request is unambiguous ("build me a pitch deck for…"), skip the confirmation. Otherwise ask once via `AskUserQuestion` whether the user wants a full deck, a deck section, or to back out.

### 2. Free-text intake (single chat message)

Ask the user, in plain text, for the inputs that don't fit a multiple-choice format. Bundle them in one message so the user can paste a single block back:

- Company name + one-sentence mission
- What you do, in plain language (1–2 sentences)
- Current stage and 2–3 proof points (revenue, growth %, marquee logos, retention, patents, etc.)
- Known investor or firm this deck is for (name + firm if known) — optional
- Ask amount + intended use of funds

If they answer terse, ask **one** follow-up. Don't loop.

### 3. Decision intake (one `AskUserQuestion` call, four questions)

Send all four in a single tool call. Suggested options (use these unless the user has already implied a choice):

**Q1 — Brand voice** (header: `Voice`)
- Confident — direct, data-led, declarative
- Warm — human, story-led, plain-spoken
- Technical — precise, architecture-aware, low fluff
- Visionary — ambitious framing, future-tense, narrative arc

**Q2 — Investor archetype** (header: `Investor`)
- Pre-seed angel — bets on team + idea
- Seed VC — bets on early signal + market
- Series A VC — bets on traction + repeatable GTM
- Strategic / Growth — bets on fit + scale economics

**Q3 — What this audience cares about most** (header: `Top concern`)
- Team — founder–market fit, prior wins
- Market — size, timing, why now
- Traction — revenue, growth, retention
- Defensibility — moat, IP, network effects
- Capital efficiency — burn, unit economics, runway

(Use `multiSelect: false` — force a primary. Secondary concerns can come up in the free-text intake.)

**Q4 — Deck depth** (header: `Depth`)
- Short — 8 slides, 1 idea per slide
- Standard — 10–12 slides (Recommended)
- Long — 15+ slides with appendix

### 3b. Targeted follow-ups (one more `AskUserQuestion` call)

Step 3 fixes the shape. Step 3b sharpens it. Pick one follow-up per axis based on what the user chose in step 3 and batch them into a single `AskUserQuestion` call (up to 4 questions). **Skip any axis where the free-text intake already answered the follow-up** — don't re-ask.

Use this lookup. Pick the row matching the user's answer; the third column is the follow-up to send.

**Voice (Q1) → follow-up**
| If Q1 = | Header | Question + options |
|---|---|---|
| Confident | `Anchor` | "Which proof point should anchor the narrative?" — list the user's proof points from the free-text intake as options |
| Warm | `Hero` | "Whose story leads the deck?" — Founder origin / Customer moment / Team mission |
| Technical | `Tech depth` | "How deep on architecture?" — Block diagram only / One detailed slide / Architecture woven through product slides |
| Visionary | `Horizon` | "Which time horizon frames the vision?" — 3-year / 5-year / 10-year+ |

**Investor archetype (Q2) → follow-up**
| If Q2 = | Header | Question + options |
|---|---|---|
| Pre-seed angel | `Team angle` | "Which credential leads the team slide?" — Prior exit / Domain operator / Unique research insight |
| Seed VC | `Signal` | "What's the strongest early signal?" — Paid pilots / LOIs / Waitlist / Prototype usage |
| Series A VC | `GTM` | "What's the GTM motion?" — Product-led / Sales-led enterprise / Hybrid |
| Strategic / Growth | `Strategic fit` | "What's the strategic angle?" — Channel fit / Acquisition target / Co-build / Distribution leverage |

**Top concern (Q3) → follow-up**
| If Q3 = | Header | Question + options |
|---|---|---|
| Team | `Lead bio` | "Which credentials lead?" — Prior co founders / Academic / Domain ops / Unusual combo |
| Market | `Market frame` | "Which market frame?" — TAM expansion / Category creation / Incumbent displacement |
| Traction | `Lead metric` | "Which metric leads?" — ARR / Growth rate / Net retention / Logo count |
| Defensibility | `Moat` | "Which moat?" — Data / Network effects / IP / Switching costs |
| Capital efficiency | `Efficiency` | "Which efficiency story?" — Low burn / Capital-light unit econ / ARR per FTE |

**Deck depth (Q4) → follow-up**
| If Q4 = | Header | Question + options | multiSelect |
|---|---|---|---|
| Short | — | skip — short deck has no optional slides | — |
| Standard | `Optional` | "Include any optional slides?" — Competitive landscape / Customer logos wall / Pricing | true |
| Long | `Appendix` | "Which appendix slides?" — Financial model / Detailed roadmap / Hiring plan / Case studies | true |

If a follow-up answer reveals a contradiction (e.g., Q3 = Traction but the user has no metrics), surface it in one short message and offer to adjust shape — don't silently paper over it.

### 4. Shape the deck

Standard slide order, then **front-load the slide that matches Q3** to position 2 or 3. Apply the Q1 voice to every headline and body line. Reweight per archetype:

| Slide | Default | Reweight rule |
|---|---|---|
| 1. Cover | logo + tagline | always |
| 2. Problem | 1 slide | +1 slide if Strategic/Growth (they need market context) |
| 3. Solution | 1 slide | + product screenshot if Seed/Series A |
| 4. Why now | 1 slide | drop if Pre-seed; expand if Strategic/Growth |
| 5. Market | TAM/SAM/SOM | lead with for VC; abbreviate for Strategic |
| 6. Product | features + how it works | + architecture beat if voice = Technical |
| 7. Traction | metrics + logos | move to slide 2/3 if Q3 = Traction |
| 8. Business model | unit economics | expand if Q3 = Capital efficiency |
| 9. Team | bios + why-us | move to slide 2/3 if Q3 = Team or archetype = Pre-seed |
| 10. Ask | amount + use of funds | always close |

Voice is non-negotiable across slides — pick it once and hold it. Proof points from the free-text intake should appear on every slide where the audience's top concern is in play.

### 5. Generate the file

Write the deck to `pitch-deck.md` in the working directory. Format:

- One `## Slide N — <title>` per slide
- Headline as the first line under the slide heading (bold)
- Body as bullets or short paragraph
- Speaker notes as a `> ` blockquote at the end of each slide

Open the file with a one-paragraph **Shape note** at the top recording every choice: voice, archetype, top concern, depth, and each follow-up answer from step 3b. This is the audit trail that makes re-shaping cheap.

### 6. Offer iteration

After writing, give the user four concrete next moves in one short message:

1. Tweak a specific slide (name it, give the change)
2. Re-shape for a different investor — re-run only Q2/Q3 and their follow-ups, regenerate
3. Swap voice — re-run only Q1 and its follow-up, regenerate
4. Sharpen one axis — re-run just the follow-up for one of Q1–Q4 without changing the main answer

Stop there. Don't auto-iterate.

## Rules

- **Always** use `AskUserQuestion` for the four decision points in step 3 *and* the follow-ups in step 3b — never inline them as a numbered list in chat. The point of the skill is the structured intake.
- The follow-up in step 3b is **conditional on** the answer in step 3 — pick the right row from each lookup table. Don't ask all the follow-ups for an axis; ask only the one for the chosen answer.
- **Never** invent brand details. If the user didn't give you a proof point, leave the slide skeletal and flag it with `[needs: …]` rather than fabricating numbers or logos.
- **Never** generate the deck before step 3b completes (or before step 3 if all four axes opted out of follow-ups, which should be rare).
- Keep the deck file as the single source of truth — edit it in place on iteration, don't fork copies.

## Extending to new content types

When adding a new type (sales narrative, board update, fundraise email):

1. Add it under "Supported content types".
2. Reuse step 2 (free-text intake) and step 3 Q1 (voice) as-is — these are content-agnostic.
3. Replace step 3 Q2–Q4 with audience + depth questions appropriate to that type.
4. Build a step 3b lookup table for each new question — one follow-up per option.
5. Replace step 4 with a shape table for that type.
6. Keep step 6 (four iteration moves) — it's the same loop.
