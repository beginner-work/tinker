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

Open the file with a one-paragraph **Shape note** at the top explaining the choices: voice, archetype, top concern, and what was front-loaded. This makes it easy to re-shape later.

### 6. Offer iteration

After writing, give the user three concrete next moves in one short message:

1. Tweak a specific slide (name it, give the change)
2. Re-shape for a different investor — re-run only Q2/Q3, regenerate
3. Swap voice — re-run only Q1, regenerate

Stop there. Don't auto-iterate.

## Rules

- **Always** use `AskUserQuestion` for the four decision points in step 3 — never inline them as a numbered list in chat. The point of the skill is the structured intake.
- **Never** invent brand details. If the user didn't give you a proof point, leave the slide skeletal and flag it with `[needs: …]` rather than fabricating numbers or logos.
- **Never** generate the deck before step 3 completes.
- Keep the deck file as the single source of truth — edit it in place on iteration, don't fork copies.

## Extending to new content types

When adding a new type (sales narrative, board update, fundraise email):

1. Add it under "Supported content types".
2. Reuse step 2 (free-text intake) and step 3 Q1 (voice) as-is — these are content-agnostic.
3. Replace step 3 Q2–Q4 with audience + depth questions appropriate to that type.
4. Replace step 4 with a shape table for that type.
5. Keep step 6 (three iteration moves) — it's the same loop.
