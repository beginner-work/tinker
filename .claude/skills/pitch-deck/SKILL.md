---
name: pitch-deck
description: Build a venture-capital-grade pitch deck through a guided interview, for users with no business background. Starts with broad identity and lifestyle questions (desired salary, what they stand for, brand spirit, what business they're in, how far they'd go), then narrows into the specifics needed to fill a standard VC deck. Use whenever the user wants to "make a pitch deck", "pitch my idea", "raise money", "deck for investors", or describes a business idea in human terms and asks for help shaping it.
---

# Pitch Deck Harness

A content harness for building a VC-grade pitch deck through conversation. The user is assumed to know **nothing** about business. You translate. They speak in feelings, conviction, identity, and dreams. You turn that into slides a partner at Sequoia would read without flinching.

## How to run the harness

This is an interview, not a form. Ask questions one or two at a time, in plain language. Reflect each answer back in your own words before moving on — the user should feel heard, and you should confirm you understood. **Never** dump all the questions at once. **Never** lecture about business concepts; translate silently.

Run three phases in order: **Foundation**, **Narrowing**, **Synthesis**. Don't move to the next phase until the current one is done. If `pitch-deck.md` already exists in the working directory, run **Phase 0 — Gap detection** first and use it to skip questions whose slides are already filled.

When you have multiple-choice or short-answer prompts, prefer the structured question tool. For open-ended reflections, just ask in conversation.

---

## Phase 0 — Gap detection (run first if `pitch-deck.md` exists)

If a `pitch-deck.md` already exists in the working directory, **Read** it before asking anything. The deck's **actual slide structure** is the source of truth — not the canonical 13-slide template. Extract the slide titles as they appear in the deck and work from that list.

Map each of the user's slide titles to the **pitch spine** below — these are the eight beats every pitch needs, regardless of how the deck is named or numbered:

1. **The problem** — the wrongness in the world the user is fighting.
2. **Why now** — what changed that makes this the right moment.
3. **The product** — what the thing is and what it does in one frame.
4. **How we make money** — pricing, the economics in one line.
5. **Go to market** — how the first customers actually find this and start paying.
6. **The moat** — what makes this hold up against competitors.
7. **The competition** — who else is in the room and how the user is different.
8. **The ask** — the number, the milestone, the terms.

These eight beats — and only these — are the gap inventory. Cover slides, section dividers, *"Thank you"* closers, and the like are decoration; they don't enter the inventory.

Classify each beat:

- **Filled** — has at least one real user line in the body of the slide that addresses the beat, no placeholder tokens.
- **Empty** — title only, no body.
- **Thin** — a single stand-in token (*"meta"*, *"TBD"*), a half-sentence, or content that doesn't address the beat. Treat as empty.
- **Placeholder** — `[NEEDS NUMBER: …]`, `[NEEDS QUOTE: …]`, or `[ASK FOUNDER: …]`. The gap is the specific missing input.
- **Missing beat** — no slide for this beat in the deck at all. Still a gap; insert it during synthesis.

**Reflect the gap inventory back to the user** in plain chat before any questions, naming each beat by the user's slide title (or by the beat name if there's no slide yet):

> *"OK, I read your deck. What's filled: The Problem, Why Now?, How We Make Money, The Moat, The Ask. What's a gap: The Product (title only — no body yet), Competition (just says 'meta'). I'll ask about each, in order. Sound right?"*

Get a confirm or correction, then ask only the questions whose beats are still gaps.

**Position each question to the gap.** Name the gap in a **plain-chat line before** the structured question. The question itself stays around 7 words. Example:

Chat: *"Your Competition slide just says 'meta'. Let's fill it."*
Question: *"Two brands that feel opposite to yours?"* *(7 words.)*

Chat: *"The Product slide is title-only right now."*
Question: *"What would somebody actually pay you for?"* *(7 words.)*

This gives the user context: every answer plugs a visible hole, but the question itself stays scannable.

If `pitch-deck.md` doesn't exist, skip this phase and run Phase 1 from scratch — every beat is a gap by default.

### Beat → question map (for gap detection)

| Beat | Filled by which question(s) |
|---|---|
| The problem | Mission branch "who is being harmed" + the wound from Foundation Q2 |
| Why now | Mission branch "what changed in the world" |
| The product | Foundation Q4 + Business branch sub-question |
| How we make money | Business branch sub-question (pricing) |
| Go to market | Always-ask GTM (see below) |
| The moat | Conviction branch "what would you do that competitors won't" |
| The competition | Brand-spirit branch "opposite brands" + Brand-spirit "one-sentence customer description" |
| The ask | Foundation Q1 paycheck + Always-ask "how much money do you need" |

If a beat is a gap, ask the question(s) in the right column. If it's filled, skip them.

**Always-ask GTM (for the Go to market beat).** Short-form canonical wording:

**Ask:** *"How will the first 100 people find this?"* *(8 words.)*

Options to offer: word of mouth (user tells user); show up where they already are (rooms, threads, feeds); content pulls them in (essays, videos, posts); a partner already has the audience. Capture the user's verbatim answer for the slide.

---

## Phase 1 — Foundation (the five broad questions)

Ask these in order. After each, reflect the answer back and capture it in a running notes block you keep in your head. **Every question shown to the user stays around 7 words** (5–10 is fine; over 12 is a bug). The bold lines below are the canonical short-form prompts — ask those. The italic long-form lines are the meaning behind each, kept for reference; never paste them at the user.

1. **"What paycheck would feel like you made it?"** *(7 words.)*
   *Long-form meaning: "If this thing worked exactly how you want, what's the paycheck that would make you feel like you made it? Annual, take-home, no funny math."* (Maps to: revenue floor, valuation expectation, company stage, lifestyle-vs-venture fork.)

2. **"What belief would you hold even costing the deal?"** *(9 words.)*
   *Long-form meaning: "What do you stand for? What's the belief you'd hold onto even if it cost you the deal?"* (Maps to: mission, "why now", the wedge against incumbents, founder-market fit.)

3. **"What's the spirit of your brand?"** *(6 words.)*
   *Long-form meaning: "If your brand walked into a room as a person, what would the room feel like after they arrived? What's the spirit of it?"* (Maps to: positioning, voice, archetype, differentiation.)

4. **"What would somebody actually pay you for?"** *(7 words.)*
   *Long-form meaning: "What business are you in? In one sentence — what would somebody actually pay you for?"* (Maps to: category, business model, ICP.)

5. **"How far would you go for this?"** *(7 words.)*
   *Long-form meaning: "How far would you go for this? What would you give up? And what wouldn't you?"* (Maps to: moat from conviction, founder commitment slide, defensibility.)

If a question needs setup — gap context, a definition, a reflection — put the setup in a plain-chat line *before* asking, then ask the short question. Don't smuggle the setup into the question itself.

After all five, summarize back: *"OK so what I'm hearing is: you want to take home `$X`, you stand for `Y`, your brand feels like `Z`, you're in the business of `W`, and you'd go as far as `V` but not past `U`. Yes?"* Get a confirm or correction before moving on.

---

## Phase 2 — Narrowing (branch on their answers)

Now you go deep, but only on the branches the foundation answers opened. Don't ask everything below — pick the questions that match what they said.

### Branch A: Money branch (from the salary answer)
- **If they named under ~$150K**: lifestyle-business risk. Say plainly: *"VCs back companies that can return their fund — that usually means $100M+ revenue. To pay you `$X` and survive, the company needs to do roughly 5–10x that in revenue. Are we aiming for venture scale, or do you want a smaller, owner-operated thing? Different deck either way."* Honor the answer.
- **If they named $250K–$1M**: standard founder territory. Ask: *"What do customers pay you, and how often? Once? Monthly? Yearly?"* This unlocks the business model slide.
- **If they named $1M+ or said "billions"**: ambition is fine. Ask: *"At that paycheck, the company is probably worth $1B+. What do you think makes this a billion-dollar opportunity and not a $50M one?"*

### Branch B: Mission branch (from "what you stand for")
- *"Who is being harmed right now by the absence of what you stand for? Describe one specific person — name, age, what their day looks like."* → **customer slide**.
- *"What changed in the world recently that makes now the right moment for this? Tech shift? Cultural shift? Regulation? A thing that broke?"* → **why-now slide**.
- *"What's the enemy? Not a competitor — the wrongness in the world you're fighting against."* → **opening slide hook**.

### Branch C: Brand-spirit branch (from the "spirit" answer)
- *"Name two or three brands today that feel like the **opposite** of yours. Why?"* → **competitive positioning**.
- *"Name one brand — any industry — whose feel you'd want to be in the same family as."* → **archetype anchor**.
- *"If a customer described you to a friend in one sentence, what's the sentence you'd want them to say?"* → **tagline candidates**.

### Branch D: Business branch (from "what business are you in")
Pick the path that matches their answer:
- **Software / app** → *"How do people find you? What do they pay? What stops them from churning?"*
- **Physical product** → *"What does it cost to make one? How do you get it to people? How many can you make in a year?"*
- **Marketplace** → *"Who's harder to get — buyers or sellers? Why are they on your side and not someone else's?"*
- **Services** → *"What part of the work could be done by software or a junior person if you wrote it down? That's the scalable wedge."*
- **Content / media** → *"Who pays — the audience or someone who wants their attention? How does the audience compound?"*
- **Hardware / deep tech** → *"What's the technical insight? What did you figure out that the rest of the field hasn't?"*

### Branch E: Conviction branch (from "how far would you go")
- *"What's the thing you'd do that a competitor with less skin in the game wouldn't? That's your unfair advantage."* → **moat slide**.
- *"What's your line — what would you not do? Be specific. 'I won't sell user data,' 'I won't make this addictive,' 'I won't lay people off in the first downturn.' That's brand collateral."* → **values, also a hiring magnet**.
- *"If everything goes wrong in 18 months, what do you do?"* → reveals founder resilience, sometimes a pivot insight.

### Always-ask follow-ups (no matter what)
- *"What's already real? Anything — a website, a prototype, a customer who said yes, an email list, a tweet that went viral. Don't be embarrassed if it's small."* → **traction slide**.
- *"Who's helping you? Co-founders, advisors, the friend who keeps showing up."* → **team slide**.
- *"How much money do you think you need to get to the next obvious milestone? Don't worry if the number is wrong."* → **the ask**.

---

## Phase 3 — Synthesis (build the deck)

Once Phases 1 and 2 are done, write the deck to a file in the user's working directory: `pitch-deck.md`. Use the template below. Each slide is a `##` heading followed by content. Keep every slide tight — investor decks live or die on **one idea per slide, big enough to read across a room**.

Translate the user's words upward, but **never invent numbers or citations**. If they said *"people who feel exhausted by their phones"* and you have no real data, the slide says *"Our audience: adults who feel their phone owns them. Sizing on slide 7."* — and slide 7 builds the size from stated arithmetic. Do **not** write *"50M+ adults report mobile fatigue (Pew, 2023)"* unless the user gave you that exact figure with that exact source. Fabricated stats — even ones flagged `[VERIFY]` — get decks thrown out the moment a partner Googles the citation.

When a number genuinely belongs on a slide and you don't have one, do one of three things, in order of preference:
1. **Ask the user** if they know the figure or have a source.
2. **Build it bottoms-up** from inputs the user gave you, and show the arithmetic on the slide: *"~40M US households with kids under 10 (Census, [VERIFY]) × 20% who pay for enrichment apps ([VERIFY assumption]) × $60/yr = ~$480M SAM."* Every input gets a source or a `[VERIFY assumption]` tag.
3. **Leave a `[NEEDS NUMBER: what kind of number, where it would come from]` placeholder.** Better an obvious gap than a fake stat.

`[VERIFY]` means "this came from a real place, double-check the figure." It does **not** mean "I made this up, please confirm." Never use it as cover for invention.

If the user is genuinely pre-traction, **say so honestly** on the traction slide. Investors smell padding; they reward earned conviction.

### Deck template

```markdown
# [Company Name] — [Tagline]

> One sentence. The user's "spirit of the brand" answer compressed to a line of poetry.

---

## 1. The problem
The wrongness in the world, named in human words. Two or three lines. Then one number that makes it real.

## 2. The solution
What you're building, said plainly. No jargon. Show, if possible — a screenshot, a sketch, a sentence describing the one moment a user feels relief.

## 3. Why now
What changed. Tech, culture, policy, behavior. One sentence on why this couldn't have worked five years ago and won't wait five more.

## 4. Who it's for
One specific person. Name, age, situation. Then: how many of them exist, and how to find them.

## 5. How it works (product)
A walk-through of the core experience in three steps. The user's first minute, first week, first month.

## 6. How it makes money
What people pay, when they pay it, and the unit economics in one line: *"We make `$X` per customer, it costs us `$Y` to acquire one, payback in `Z` months."*

## 6.5 Go to market
How the first 100 paying customers actually find this — one sentence, in the user's own words. Word of mouth, showing up where they already are, content that pulls them in, a partner who already has the audience. Be specific about *which* rooms / threads / partners.

## 7. Market size
Show the arithmetic. Every figure on this slide must be either (a) a real cited source or (b) the product of inputs that are themselves cited or explicitly flagged as assumptions. Format: *"`N` people × `$P` per year = `$M` market"*, with `N` and `P` each followed by a source or a `[VERIFY assumption]` tag. **Do not** write phrases like *"tens of millions globally"*, *"a massive market"*, or *"$Xbn TAM"* without showing the multiplication that gets you there. If you don't have enough inputs to build the arithmetic, write `[NEEDS NUMBER: …]` and stop — a blank is better than a bluff.

## 8. Why us
Founder-market fit. The conviction answer goes here — what the founder will do that competitors won't. Translate "I'd give up `V`" into "We're the team that will outlast everyone else in this category because [reason]."

## 9. Competition
A 2x2 or short table. Two axes drawn from the brand-spirit branch (e.g. *"calm vs. loud"* × *"private vs. ad-funded"*). Place competitors. Place us in the empty quadrant.

## 10. Traction
Honest. If there's revenue, say it. If there's a waitlist, say it. If there's nothing yet, say *"Pre-launch. What we have is `[founder's domain expertise / prototype / signed LOI / community]`."*

## 11. Team
Founders, what they did before, why they're the ones to do this. One line each.

## 12. The ask
*"Raising `$X` to get to `[next milestone]` in `[timeframe]`. Funds go to: `[role 1]`, `[role 2]`, `[infrastructure]`, `[runway]`."* Tie back to the salary answer — the founder's compensation should be inside this number and reasonable for the stage.

## 13. The line in the sand
Closing slide. The user's answer to "what would you give up." One sentence. This is the slide investors quote back when they say yes.
```

---

## Tone rules for the whole conversation

- Talk like a smart friend who happens to know how money works. Not a consultant.
- **Never invent numbers.** No market sizes, audience counts, growth rates, dollar figures, or citations may appear in the deck unless the user supplied them, you derived them from arithmetic on inputs that are themselves sourced or tagged `[VERIFY assumption]`, or you've left a `[NEEDS NUMBER: …]` placeholder. Phrases like *"tens of millions globally"*, *"a $Xbn market"*, or *"50M+ adults (Pew, 2023)"* — written without the multiplication or a real citation — are the failure mode this rule exists to prevent.
- Never use the words *synergy*, *disrupt*, *leverage* (verb), or *go-to-market* with the user. Use them only in the deck output, and only if they actually fit.
- If the user says something that's not viable as a venture-scale business, **tell them**, and offer the lifestyle-business or bootstrapped path as an honest alternative. The goal is the right deck, not a deck.
- If an answer is vague, ask one sharper question, not five. *"Tell me more"* is fine when you mean it.
- Celebrate good answers briefly and move on. *"That's the line. Keep going."*

## When the deck is done

After writing `pitch-deck.md`, read it back to the user as a short summary (3–4 lines), point out any `[VERIFY]` stats they need to check, and ask: *"Want me to tighten any slide, or are we good?"*
