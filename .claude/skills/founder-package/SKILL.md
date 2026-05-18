---
name: founder-package
description: One guided interview that produces a pitch deck, a product spec, or a pitch narrative — depending on what the founder needs. Starts with a single routing question ("What are you building? A pitch deck, a product, or a pitch narrative?"), then runs the full interview for that artifact through the question loader (AskUserQuestion) so the founder can iterate option by option. The major change from the standalone pitch-deck skill is the verbatim rule — when building a pitch deck, every line of slide content uses the founder's own words, with no upward translation into VC vocabulary. Use whenever the founder says "help me with my pitch / product / narrative", "I have an idea, where do I start", or invokes the founder package directly.
---

# Founder Package

A unified harness that produces one of three artifacts:

- A **pitch deck** → `pitch-deck.md`
- A **product spec** → `build-prompt.md` (and optionally `product-spec.md`)
- A **pitch narrative** → `pitch-narrative-coworker.md`, `pitch-narrative-family.md`, and/or `pitch-narrative-friend.md`

The founder opens this skill not knowing which artifact they need yet. The skill starts with one routing question and runs the right flow from there.

## Operating rules (all flows)

- **Every question goes through the AskUserQuestion tool — the question loader.** This is non-negotiable across all three flows. Open-ended foundation prompts, structured narrowing prompts, every always-ask follow-up — all of them go through the loader. The loader's "Other" option preserves open-endedness without dropping into plain-chat questions. Reflections back to the founder (*"OK, so what I'm hearing…"*) stay in plain chat — those are confirmations, not questions.
- **One artifact per session.** Do not try to build two of the three in one run. After Phase 3 completes for the chosen artifact, you may offer to start a second run for another artifact, but it's a new pass with its own opening question.
- **Translate concepts silently.** The founder is assumed to know nothing about business, product management, or pitching. Never lecture about MVP, retention, TAM, runway, traction, funnel, churn, PMF, go-to-market, or unit economics. Translate in your head; speak plainly.
- **Never invent numbers, users, screens, features, citations, or quotes.** Every concrete claim in any output file traces to something the founder said. If a section needs information you don't have, leave a placeholder (`[NEEDS NUMBER: …]`, `[NEEDS INPUT: …]`, `[ASK FOUNDER: …]`) rather than fabricating.
- **Voice rule.** Ask like a friend who's curious about the founder's life and work — not a form collecting requirements. The internal labels in question headings (*Q3 — Opening beat*) are model-only and do not appear to the founder.

## Phase 0 — Routing (always first)

Before anything else, ask the founder one question via **AskUserQuestion**, using exactly this wording and these options:

> **What are you building? Are you building a pitch deck, a product, or a pitch narrative?**

| Option | Description |
|---|---|
| A pitch deck | A document for investors — slides that explain what you're building and why someone should give you money. We'll fill out a VC-grade deck in your own words. |
| A product | The thing you're actually going to ship. We'll spec out the smallest version you can build next, in a form a build agent (or future you) can execute. |
| A pitch narrative | The "in your own voice" version of your pitch — the way you'd tell a coworker, a family member, or a friend. Requires that a `pitch-deck.md` already exists. |

After the founder answers, route:

- **A pitch deck** → run [Pitch Deck Flow](#pitch-deck-flow).
- **A product** → run [Product Spec Flow](#product-spec-flow).
- **A pitch narrative** → first check that `pitch-deck.md` exists in the working directory. If yes, run [Pitch Narrative Flow](#pitch-narrative-flow). If no, stop and tell the founder to build the deck first (offer to run the pitch deck flow now via AskUserQuestion with options *"Yes, let's build the deck first"* / *"No, I'll come back later"*).

Reflect the routing in chat after they choose (*"Got it — pitch deck. Three phases: a few broad questions about you, then narrower ones about the specifics, then I'll write the deck."*) so they know what's coming.

---

# Pitch Deck Flow

A VC-grade pitch deck, told entirely in the founder's own voice.

## The verbatim rule (this flow's defining constraint)

**The slide body content uses ONLY verbatim language from the founder.** No upward translation into VC vocabulary. No paraphrasing into "category-appropriate" diction. If the founder said *"people who feel exhausted by their phones"*, the slide says *"people who feel exhausted by their phones"* — not *"adults experiencing mobile fatigue"*, not *"the digital wellness consumer segment"*, not *"a generation overwhelmed by their devices."* The founder's words are the deck.

Slide **titles** can use fixed UI strings drawn from the template (*"The problem"*, *"Why now"*, *"The ask"*, *"How it works"*). Slide **body content** must be one of:

- (a) a verbatim quote from the founder's answers in Phases 1 and 2, OR
- (b) a number / citation the founder explicitly supplied with a source, OR
- (c) an arithmetic combination of (b) values, with the multiplication shown on the slide.

Anything outside (a), (b), or (c) is a bug. Before you consider the deck done, walk every line of every slide and verify it traces to a founder quote, a sourced figure, or arithmetic on sourced figures. If a line doesn't trace, replace it with the closest founder quote that does, or leave `[NEEDS QUOTE: what kind of line, what slide]`.

This means the model's job during Phase 3 is **selection and arrangement**, not generation. You're a curator, not a copywriter. Pick the founder's strongest line for each slide. Order them. Don't smooth the seams — the seams are the founder's voice.

Why this rule exists: investors who would back this founder are backing the founder, not a deck-shaped translation of the founder. Upward translation makes every deck sound the same. The verbatim rule keeps the deck specific, defensible, and unmistakably authored.

## Phase 0A — Gap detection (run first if `pitch-deck.md` exists)

Before asking anything, **Read** `pitch-deck.md` from the working directory. If it doesn't exist, skip this phase and run the full Foundation + Narrowing sequence.

If it does exist, inventory the 13 slides. A slide is **filled** only if:

- it has at least one verbatim founder line in its body (not just a slide title), AND
- the content matches the slide's purpose (e.g. slide 9 is actually about competitors, not just the word *"meta"*), AND
- the content is not a placeholder (`[NEEDS QUOTE]`, `[NEEDS NUMBER]`, `[ASK FOUNDER]`, `TBD`, a single stand-in word).

Anything else is a **gap**. Build a list in your head, keyed by slide number. Common shapes:

- **Empty slide** — title only, no body. The whole slide is a gap.
- **Thin slide** — one stray token like *"meta"* or a half-sentence. Treat as empty.
- **Placeholder slide** — `[NEEDS NUMBER: …]` or similar. The gap is the specific missing input, not the whole slide.

**Position each question to the gap it fills.** For every AskUserQuestion call in Phase 1A and Phase 2A, do two things:

1. Set the `header` chip to the slide name in compact form: *"Slide 9 — Comp"*, *"Slide 12 — Ask"*, *"Slide 13 — Line"*, etc. (12-char max — use abbreviations.)
2. Open the `question` text by naming the gap in the founder's deck before asking. Example:
   > *"Slide 9 in your deck just says 'meta' right now. Let's fill it — name two or three brands today that feel like the OPPOSITE of yours."*

Or for an empty slide:
   > *"Slide 10 (traction) is empty. What's already real? Anything — a website, a prototype, a customer who said yes, an email list."*

This gives the founder context: every question they answer plugs a visible hole, not a generic interview prompt.

**Skip the questions whose slides are already filled.** If slide 6 (How it makes money) already has a verbatim founder line, do not ask Foundation Q4's business sub-question for pricing — that gap is closed. Only ask the questions whose slides are still gaps.

**Reflect the gap inventory back to the founder** in plain chat at the start, so they confirm what we're filling:

> *"OK, I read your deck. What's filled: slides 1, 2, 3, 6, 7. What's a gap: slide 4 (who it's for), slide 5 (how it works), slide 9 (just says 'meta' — let's fix that), slide 10 (traction), slide 11 (team), slide 13 (the line). I'll ask you about each, in order. Sound right?"*

After confirmation, ask the gap-targeted questions one at a time. Skip Foundation Q1–Q5 entirely if all the slides they map to are already filled.

If `pitch-deck.md` doesn't exist, ignore this phase and run Phase 1A from scratch.

### Slide → question map (for gap detection)

| Slide | Filled by which question(s) |
|---|---|
| 1 — Tagline / cover | Foundation Q3 + Brand spirit branch "one-sentence customer description" |
| 2 — The problem | Mission branch "who is being harmed" + the wound from Foundation Q2 |
| 3 — Why now | Mission branch "what changed in the world" |
| 4 — Who it's for | Mission branch "one specific person" |
| 5 — How it works | Foundation Q4 + Business branch sub-question |
| 6 — How it makes money | Business branch sub-question (pricing / model) |
| 7 — Market size | Founder-supplied figures only; arithmetic from inputs |
| 8 — Why us | Conviction branch "what would you do that competitors won't" |
| 9 — Competition | Brand spirit branch "opposite brands" |
| 10 — Traction | Always-ask T1 |
| 11 — Team | Always-ask T2 |
| 12 — The ask | Foundation Q1 paycheck + Always-ask T3 |
| 13 — Line in the sand | Conviction branch "what's your line" |

Use this table to decide which questions to ask. If slide N is a gap, ask the question(s) in the right column. If slide N is filled, skip them.

## Phase 1A — Foundation (five questions via AskUserQuestion)

Ask each of these one at a time through the loader, in order. The options are common archetypes — the founder is encouraged to use **Other** if their real answer doesn't fit. Capture the founder's exact words for every answer; those exact words are what end up on slides.

After each question, reflect the answer back in plain chat in the founder's own voice (*"OK — so the paycheck that makes you feel like you made it is $300K, and you'd take it as salary. Got it."*).

### Foundation Q1 — Paycheck

> If this thing worked exactly how you want, what's the paycheck that would make you feel like you made it? Annual, take-home, no funny math.

| Option | Description |
|---|---|
| Under $150K — a stable, sustainable life | I want enough to live well; I'm not chasing a unicorn. |
| $250K–$1M — comfortable, room to invest in the work | Standard founder territory; I'm building something real. |
| $1M+ — I'm building something venture-scale | I'm aiming for a billion-dollar outcome. |
| I haven't thought about it that way yet | Force me to pick a number now. |

*(Maps to: revenue floor, valuation expectation, lifestyle-vs-venture fork. The founder's chosen number — verbatim — goes on the ask slide.)*

### Foundation Q2 — What you stand for

> What do you stand for? What's the belief you'd hold onto even if it cost you the deal?

| Option | Description |
|---|---|
| People deserve their time back | I'm fighting against the extraction of attention or labor. |
| Truth and transparency beat polish | I'm fighting against the performance the system asks for. |
| Care for people the system overlooks | I'm fighting for people who don't fit the pattern. |
| Beauty, craft, doing things the right way | I'm fighting against the cheapness of the default. |

The founder will almost always pick **Other** here — that's expected. Capture their exact phrasing. The verbatim line goes on slide 2 (the wound) and slide 4 (the thesis).

### Foundation Q3 — Brand spirit

> If your brand walked into a room as a person, what would the room feel like after they arrived? What's the spirit of it?

| Option | Description |
|---|---|
| Calm and grounded — the room exhales | Quiet confidence, low contrast, low volume. |
| Sharp and direct — the room sits up | Clear-eyed, no fluff, says the hard thing first. |
| Warm and inviting — the room leans in | Personal, generous, makes space for the listener. |
| Playful and surprising — the room laughs | Specific in a way that catches you off guard. |

*(Maps to: positioning, voice, archetype. The founder's word for the spirit — verbatim — informs slide 1's tagline and slide 9's competitive axes.)*

### Foundation Q4 — What business are you in

> What business are you in? In one sentence — what would somebody actually pay you for?

| Option | Description |
|---|---|
| Software / app people pay to use | A product running on a screen; SaaS, web app, mobile. |
| Marketplace connecting two sides | Two groups of people who pay because the other side is there. |
| Physical product I make and sell | A thing that exists in the world; I ship it. |
| Services, coaching, or expertise | I do the work; people pay me for the doing. |

The founder's verbatim one-sentence answer goes on slide 6 (product) and informs slide 8 (business model).

### Foundation Q5 — How far you'd go

> How far would you go for this? What would you give up? And what wouldn't you?

| Option | Description |
|---|---|
| I'd give up most things — this is the work | The work is the priority; comfort is negotiable. |
| I'd give up money but not my values | I'd take less to keep the line I won't cross. |
| I'd give up time but not my health | I'll work hard; I won't burn out for it. |
| I haven't thought about the line yet | Force me to find the line now. |

The founder's verbatim answer — both the *"how far"* and the *"but not"* — goes on slide 10 (why us / why me) and slide 13 (the line in the sand). Both halves matter.

After all five, summarize back in chat using the founder's own words: *"OK so what I'm hearing is: you want to take home $X, you stand for `[founder's exact words]`, your brand feels like `[founder's exact word]`, you're in the business of `[founder's exact one-sentence answer]`, and you'd go as far as `[…]` but not past `[…]`. Yes?"* Get a confirm or correction. If the founder corrects, capture the corrected wording verbatim — the corrected version is the one that ends up on the deck.

## Phase 2A — Narrowing (branch on their answers)

Pick the branches the foundation answers opened. Don't ask everything below — match the question to what they said. Every question goes through **AskUserQuestion**. Capture verbatim quotes for every answer.

### Money branch (from Foundation Q1)

If the founder picked "Under $150K", ask via AskUserQuestion:

> Heads up — VCs back companies that can return their fund, which usually means $100M+ in revenue. To pay you that take-home and survive, the company needs to do about 5–10x that. Are we aiming for venture scale, or a smaller owner-operated thing? Different deck either way.

| Option | Description |
|---|---|
| Smaller, owner-operated — lifestyle business | I want the deck for friends-and-family, customers, or grant funders. |
| Venture scale — let's stretch the paycheck | I'd take more if it meant a real shot at building big. |
| I want both decks | One for venture, one for the lifestyle path. |

Honor the answer. If lifestyle, swap the deck template to a lifestyle-business pitch (no slide 12 "ask" in venture format; replace with "what funding I'm seeking and from whom"). If venture, continue the standard template.

If the founder picked "$1M+", ask:

> At that paycheck, the company is probably worth $1B+. In one sentence — what makes this a billion-dollar opportunity and not a $50M one?

(Loader options: *"The market is genuinely huge — millions of paying customers"*, *"The product has compounding network effects"*, *"It replaces something with a giant existing budget"*, *"I haven't thought about that yet — force me to."* Capture the founder's verbatim Other answer if they pick it; that line goes on slide 7.)

### Mission branch (from Foundation Q2)

Ask via AskUserQuestion:

> Who's being harmed right now by the absence of what you stand for? Describe one specific person — name, age, what their day looks like.

(Loader options: *"A maker I know personally — they have a name"*, *"A type of person — I can describe their day in detail"*, *"A community I'm part of"*, *"I haven't picked one specific person yet"*. The founder's "Other" or chosen description, verbatim, goes on slide 4 — who it's for.)

Then ask:

> What changed in the world recently that makes now the right moment for this? Tech shift, cultural shift, regulation, something that broke?

(Loader options: *"AI changed what one person can build"*, *"A cultural conversation became public that wasn't before"*, *"A regulation shifted what's possible or required"*, *"The cost of something collapsed or spiked"*. The founder's verbatim words for the shift go on slide 3 — why now.)

### Brand spirit branch (from Foundation Q3)

Ask via AskUserQuestion:

> Name two or three brands today that feel like the OPPOSITE of yours.

(Loader options: *"Loud / hype-driven brands"*, *"Polished corporate brands"*, *"Cheap mass-market brands"*, *"Soulless tech brands"*. The founder's specific names — captured in chat as Other if they have them — go on slide 9.)

Then:

> If a customer described you to a friend in one sentence, what's the sentence you'd want them to say?

(Loader options: *"It's the calm one"*, *"It's the honest one"*, *"It's the one that actually works for me"*, *"It's the one that gets me"*. The founder's verbatim sentence becomes the tagline candidate for slide 1.)

### Business branch (from Foundation Q4)

Branch on the founder's Q4 answer. Pick the matching sub-question and ask via AskUserQuestion.

**If software / app:**
> How do people find you, what do they pay, and what stops them from churning?

| Option | Description |
|---|---|
| Word of mouth — monthly subscription | People hear from a friend; pay monthly to keep using. |
| Search / content — annual subscription | People find me via what I make; pay yearly. |
| Direct sales — usage-based | I sell to companies; they pay per use. |
| I haven't figured this out yet | Force me to pick. |

**If marketplace:**
> Who's harder to get — buyers or sellers? Why are they on your side and not someone else's?

(Loader options: *"Sellers are harder — I have the buyers"*, *"Buyers are harder — I have the sellers"*, *"Both are hard; I have a magnet for one side"*, *"I haven't figured this out yet"*.)

**If physical product:**
> What does it cost to make one, how do you get it to people, how many can you make in a year?

(Loader options: *"I make them by hand; small batch"*, *"I have a manufacturer; I can scale to 10K+"*, *"It's drop-shipped or print-on-demand"*, *"I haven't figured out manufacturing yet"*.)

**If services / coaching:**
> What part of the work could be done by software or a junior person if you wrote it down? That's the scalable wedge.

(Loader options: *"The intake / onboarding"*, *"The first deliverable / template"*, *"The follow-up / accountability"*, *"None of it — the work is the work, that's the point"*.)

The founder's verbatim answer to the matching sub-question goes on slide 6 (product) and slide 8 (business model).

### Conviction branch (from Foundation Q5)

Ask via AskUserQuestion:

> What's the thing you'd do for this work that a competitor with less skin in the game wouldn't?

| Option | Description |
|---|---|
| Live the same problem I'm solving | I'm a user of my own thing — the only one in the category. |
| Refuse a feature that makes more money but hurts users | I'd take less revenue to keep the line clean. |
| Build slower than everyone tells me to | I'd lose the race on purpose to land it right. |
| Stay at this years longer than is rational | I'll outlast the competition by being unable to leave. |

The founder's verbatim answer — Other if it's truly theirs — goes on slide 10 (why us).

Then ask:

> What's your line — what would you not do?

(Loader options: *"No selling user data"*, *"No making this addictive"*, *"No laying people off in the first downturn"*, *"No raising at terms that compromise the work"*. The founder's verbatim answer goes on slide 13.)

### Always-ask follow-ups (no matter which branches)

Ask each via AskUserQuestion. The verbatim answers go on the slides indicated.

**T1 — Traction.**
> What's already real? Anything — a website, a prototype, a customer who said yes, an email list, a tweet that went viral. Don't be embarrassed if it's small.

| Option | Description |
|---|---|
| Real revenue from real customers | At least one person has paid me. |
| A working prototype people have touched | The thing exists; some humans have used it. |
| A waitlist or audience | I have a list of people who want this. |
| Pre-launch — nothing concrete yet | I have conviction and not much else. |

The founder's verbatim Other answer (if any) is the slide 7 content. If pre-launch, slide 7 says exactly that — honestly. *"Pre-launch. What I have is `[founder's words]`."*

**T2 — Team.**
> Who's helping you? Co-founders, advisors, the friend who keeps showing up.

| Option | Description |
|---|---|
| Solo — I'm the whole team | Just me. |
| Co-founder(s) | One or more people on the cap table with me. |
| Solo with named advisors | Just me on the cap table, but a few people in my corner. |
| Solo with a freelance bench | I'm the only employee; I hire help as needed. |

If they pick anything other than solo, ask one short open-ended follow-up via plain chat for the names. Names go on slide 11.

**T3 — The ask.**
> How much money do you think you need to get to the next obvious milestone? Don't worry if the number is wrong.

| Option | Description |
|---|---|
| Under $100K — a runway extension | Just enough to keep going for a few months. |
| $100K–$500K — pre-seed / friends-and-family round | Standard small-check round. |
| $500K–$2M — seed round | A typical institutional seed. |
| $2M+ — priced seed or Series A | A larger round with named lead. |

The verbatim number and the verbatim "next obvious milestone" go on slide 12.

## Phase 3A — Synthesis (write the deck)

Write the deck to `pitch-deck.md` in the working directory. Use the template below.

**Apply the verbatim rule.** Every line of body content on every slide must be one of:
- (a) a verbatim quote from the founder's transcript (Foundation Q1–5, Narrowing sub-questions, T1–T3, any chat reflections the founder confirmed),
- (b) a number or citation the founder explicitly supplied, OR
- (c) arithmetic on (b) values with the multiplication shown.

Anything else is a bug. Replace with the founder's closest line that fits, or leave `[NEEDS QUOTE: what kind of line, what slide]`.

Numbers rules (carried over from the original pitch-deck skill):
- Never invent figures, audience sizes, market sizes, growth rates, or citations.
- For market sizing on slide 7, show the arithmetic: *"`N` people × `$P` per year = `$M` market"* with each input either sourced or flagged `[VERIFY assumption]`.
- If a number genuinely belongs and you don't have one, leave `[NEEDS NUMBER: …]`. A blank is better than a bluff.
- `[VERIFY]` means "this came from a real place, double-check the figure." It is not cover for invention.

### Deck template

```markdown
# [Company Name] — [Tagline, verbatim from Foundation Q3 follow-up]

> [One verbatim founder line from Foundation Q2 or Q3, compressed to a single sentence — but only by trimming, not by translating.]

---

## 1. The problem
[Founder's verbatim answer from the Mission branch on what's wrong. Two or three lines, in their words.]

## 2. The solution
[Founder's verbatim answer from Foundation Q4 — the one-sentence "what business are you in" — possibly extended with their verbatim answer to the Business branch sub-question.]

## 3. Why now
[Founder's verbatim words from the Mission branch on what changed in the world.]

## 4. Who it's for
[Founder's verbatim description of the one specific person from the Mission branch. Then the sizing arithmetic from slide 7 referenced, or `[NEEDS NUMBER: …]`.]

## 5. How it works
[Founder's verbatim words for what the user does, what they get. Pull from Foundation Q4 + the Business branch sub-question.]

## 6. How it makes money
[Founder's verbatim words from the Business branch on pricing / model.]

## 7. Market size
[Arithmetic only. Every input cited or `[VERIFY assumption]`-flagged. If the founder didn't supply inputs, this slide is `[NEEDS NUMBER: arithmetic from founder-supplied inputs]`.]

## 8. Why us
[Founder's verbatim answer from the Conviction branch — what they'd do that competitors won't.]

## 9. Competition
[A 2x2 or short table. Axes drawn from the founder's verbatim words about the brand spirit and its opposite. Competitors named only if the founder named them.]

## 10. Traction
[Founder's verbatim T1 answer. If pre-launch, the slide says so honestly in the founder's own words.]

## 11. Team
[Founder's verbatim T2 answer plus any names they gave in chat.]

## 12. The ask
[Founder's verbatim T3 answer — the number, the milestone, and their own breakdown of what the money is for.]

## 13. The line in the sand
[Founder's verbatim Conviction branch answer to "what's your line — what would you not do."]
```

### When the deck is done

1. Read it back as a 3–4 line summary in plain chat. Point out any `[NEEDS NUMBER: …]`, `[NEEDS QUOTE: …]`, or `[VERIFY]` placeholders.
2. Run the verbatim check: walk every line of every slide; verify it traces to a founder quote, a sourced figure, or arithmetic. Report any line that doesn't trace, and either replace it or leave a `[NEEDS QUOTE]`.
3. Ask via AskUserQuestion: *"Does this sound like you, or do we tighten any slide?"* with options *"Yes, this is the deck"*, *"Mostly — tighten one slide"*, *"The verbatim version sounds rough in spots — smooth one section by hand"*, *"Something fundamental is off — let's revisit"*.

If they want edits, edit the file in place — don't rewrite from scratch unless they ask. When the founder hand-smooths a slide, treat their new wording as the new verbatim source for that slide.

---

# Product Spec Flow

A buildable product spec, producing `build-prompt.md` (the imperative artifact a build agent executes).

## Pre-checks (run before Phase 1B)

- **If `pitch-deck.md` exists**, read it first as background. The deck is *who and why*; the build prompt is *what actually ships*. Don't repeat deck content in the build prompt — refer to it. And don't let the deck constrain the build prompt: if the founder wants to ship one slice of a bigger platform, that's the right move.
- **If the working directory looks like an existing app shell** (it has `README.md` and `src/`), the product likely lives inside that shell, not greenfield. Read the README first; skim `src/` to identify the structural primitives the new screen will inherit (tabs, sidebar, welcome page, address bar, modal stack, navigation rail). Note their file paths. The build prompt's "Read first" and "Constraints" sections will enumerate them by name. **Do this before Phase 1B, not after** — the single most common failure is producing a greenfield build prompt when the founder is actually building inside an existing app.
- **If the founder has more than one product idea in flight**, ask via AskUserQuestion: *"Which one are we speccing today?"* with one option per idea + closing line in chat: *"We can do the others in a separate pass."* One product per session.

## Phase 1B — Foundation (prelude + five questions via AskUserQuestion)

### Prelude — Platform target

Ask via AskUserQuestion before the five foundation questions:

> Before we dig into the product itself: where does this run first?

| Option | Description |
|---|---|
| Web / PWA in a browser | A website people open in a browser; works on any device. The safe default if you're not sure. |
| Desktop app I install | A native app for Mac / Windows / Linux. |
| Phone app | A native app for iPhone or Android. |
| All of the above from one codebase | One codebase, web-first, then native shells after. |

If "all of the above", the build prompt phases the work (web/PWA first, native shells after explicit approval). If single-target, no phasing.

### The five foundation questions

Ask each via AskUserQuestion, one at a time, in order. Reflect each answer back in plain chat. The "Other" option is the escape hatch — encourage the founder to use it freely.

**F1 — Hero moment.**
> Picture one specific person using your thing for the first time. What's the one moment where they go "oh — this is for me"?

| Option | Description |
|---|---|
| They see a result that solves their problem in one shot | Output → done. |
| They feel understood — the product knows them | Recognition → relief. |
| They finish something they'd been putting off | Closure → relief. |
| They share it with someone immediately | Spark → reach. |

**F2 — Status quo.**
> What did that same person do yesterday — before your thing existed — to handle this?

| Option | Description |
|---|---|
| Nothing — they lived with the problem | The wedge is "noticing it at all". |
| A manual workaround (spreadsheet, notes app, paper) | The wedge is replacing the workaround. |
| A different product that's clunky or expensive | The wedge is doing it better. |
| They paid a person to do it for them | The wedge is making the service self-serve. |

**F3 — One tiny thing.**
> If your thing could only do one tiny thing well, and absolutely nothing else, what would that one thing be?

| Option | Description |
|---|---|
| Take an input and return a finished output | A tool. |
| Show the user something they couldn't see before | A view. |
| Save them a step they do every day | A shortcut. |
| Connect them to a person or community | A bridge. |

**F4 — In and out.**
> What goes in, what comes out? What does the person hand to your thing, and what do they walk away with?

| Option | Description |
|---|---|
| They give text / answers → get a generated artifact | Inputs → output document. |
| They upload a file → get it transformed | File in → file out. |
| They configure something → get a saved workspace | Settings → state. |
| They ask a question → get an answer or recommendation | Q → A. |

**F5 — The line.**
> What's the line — what would your thing definitely NOT do, even if a user begged?

| Option | Description |
|---|---|
| No AI-written content / no generated words on the page | Authorship stays human. |
| No social features / no public profiles or feeds | No performance layer. |
| No ads, tracking, or data resale | No extraction. |
| No enterprise / B2B features even if asked | Stays for the original user. |

After all five, summarize in plain chat: *"OK, so what I'm hearing: someone in `[situation X]` opens this thing, the moment they feel it is `[Y]`, the closest thing they do today is `[Z]`, the smallest version of your product is just `[W]`, and you'd never build `[V]`. Yes?"* Get a confirm or correction.

## Phase 2B — Narrowing (Q1–Q8 + always-ask follow-ups, all via AskUserQuestion)

Send questions in batches that flow conversationally — never dump them all at once. Pair Q1+Q2 in one call if it flows; same with Q5+Q6.

After each batch, reflect in plain chat (*"Got it — they open it daily, it's a feed, and the thing that brings them back is a draft they left half-finished."*).

### Q1 — How often (singleSelect)

> How often do you imagine that person using your thing, once it's a regular part of their life?

| Option | Description |
|---|---|
| Once and done | Tax filing. Naming a baby. Writing a will. |
| Now and then | A few times a year, when the situation comes up. |
| Weekly-ish | A regular part of their week. |
| Daily | They open it every day, sometimes more. |

### Q2 — Shape of the thing (singleSelect)

> When that person uses it, what shape does it take?

| Option | Description |
|---|---|
| A page they fill in | Forms, fields, a thing they configure. |
| A feed they read | Posts, items, a list that changes over time. |
| A tool that does the work | They press a button, it produces an output. |
| A space they live in | A workspace they come back to. |
| A conversation | They talk to it, it talks back. |

**Always-ask follow-up to Q2.** If the founder picked *A conversation* or *A tool that does the work*, ask this next via AskUserQuestion:

> In what shape does that conversation or tool take place?

| Option | Description |
|---|---|
| Chat (text area at the bottom, thread climbs up) | Like ChatGPT. Persistent input box, message bubbles, scroll history. |
| Onboarding flow (one question at a time, paginated) | Like Typeform or Stripe's setup. Big focus, progress indicator, one prompt per screen. |
| Wizard (named steps with a Next button) | Like a tax-prep app. Discrete labeled steps. |
| Something else | Pick this if none of the above match. |

This distinction is the difference between a ChatGPT clone and a guided experience — both conversational, opposite UI shapes.

### Q3 — First-time experience (singleSelect)

> The very first time someone opens your thing — before they've signed up, paid, or done any work — what should they see?

| Option | Description |
|---|---|
| The thing already working with example data | Alive, populated, doing its job. |
| One question, asked of them | A single prompt that invites them in. |
| A blank canvas with one button | Empty, but with a clear "start here" gesture. |
| Someone else's work, beautifully | A gallery or feed that earns trust before asking anything. |

### Q4 — What brings them back (multiSelect)

> If they leave and come back tomorrow, why? Pick all that fit — or pick the last one if the honest answer is they wouldn't.

| Option | Description |
|---|---|
| Something changed while they were gone | New content, new replies, new opportunity. |
| They have unfinished work in here | A draft, a project. |
| They get a result on a schedule | The calendar pulls them back. |
| Someone they care about is here | A person, a community. |
| You sent them a notification | Email, push, text. |
| They wouldn't, really | One-and-done is the honest answer. |

### Q5 — Hardest moment (singleSelect)

> Where do you think the average person will get stuck or give up?

| Option | Description |
|---|---|
| Before they sign up — they don't get what it is | Pitch is the bottleneck. |
| At the empty state — they don't know what to put in | Freeze on first use. |
| Halfway through their first task — too much work for too little payoff | The work-to-value ratio is wrong. |
| After their first win — they don't see why to come back | The loop isn't earned. |
| You're not sure | Honest answer. |

### Q6 — Risk you're most worried about (singleSelect)

> When you imagine launching and it not working, what's the failure that scares you most?

| Option | Description |
|---|---|
| Nobody shows up | The audience doesn't find it or doesn't care. |
| People show up but bounce | Look around, leave. |
| People love it but won't pay | Engagement without revenue. |
| It works but doesn't scale | First 10 are fine; the next 1,000 break it. |
| You burn out before it lands | The build is bigger than you can carry. |

### Q7 — Visual canon (singleSelect)

> When the page renders for the first time, what should it look like? Where does the visual truth live?

| Option | Description |
|---|---|
| The existing app I already have | Same chrome, fonts, colors, buttons. A sibling, not a new design. |
| My own design tokens / dictionary | I have brand tokens or a style file. |
| A specific reference | I have a reference product or screenshot. |
| Nothing yet — pick before code | Force me to pick before synthesis. |

If "Nothing yet — pick before code", stop and force the decision before Phase 3B.

### Q8 — Mood / emotional register (singleSelect)

> When the screen renders and the user's eye lands on it, what should it feel like emotionally?

| Option | Description |
|---|---|
| Quiet home | Calm, lived-in, low-contrast. Familiar. |
| Focused workshop | Purposeful, tool-like. Every element has a job. |
| Curriculum just for you | Personal, considered, bespoke. |
| Playful & warm | Soft expressive touches, gentle warmth. |

**Always-ask follow-up to Q8.** Force one concrete UI cue that carries the mood, so the constraint can be checked, not just felt. Match the option set to the Q8 answer:

For *Quiet home*: generous padding, no separators, muted single-color palette, soft hover with no animation.
For *Focused workshop*: clear row separators, tighter spacing, defined hover/active states, visible affordances.
For *Curriculum just for you*: numbering markers on top-level items, sense of "where you've been vs what's new", typographic weight that shifts by tier, breathing pattern that tightens as the tree gets deeper.
For *Playful & warm*: warm accent color used sparingly, soft micro-motion on interaction, friendly glyphs, generous corner radius.

Multi-select is fine. The selected cue becomes a checkable constraint in the build prompt.

### Always-ask follow-ups (F-prefix)

Ask each via AskUserQuestion, one per call, after Q8.

**F1' — Existing pieces.**
> What pieces of this already exist anywhere — a doc, a sketch, a half-built prototype, a piece of someone else's app you keep referencing?

| Option | Description |
|---|---|
| A written doc / notes / a pitch | A document. |
| A sketch, wireframe, or Figma | A visual. |
| A half-built prototype or code | Some code already exists. |
| Nothing yet — it's all in my head | Greenfield. |

**F2' — One screen.**
> If a contractor said "I can build you exactly one screen this month" — which screen?

| Option | Description |
|---|---|
| The first-time / onboarding screen | The pitch screen. |
| The main thing-they-do screen | The core action. |
| The result / output screen | The payoff. |
| The dashboard / home / feed they return to | The return loop. |

**F3' — Success signal.**
> How would you know, in one week, that you should keep building this — or stop?

| Option | Description |
|---|---|
| A specific person uses it without me prompting them | Real adoption signal. |
| Someone I don't know finishes the core flow | Cold-start signal. |
| Someone pays me / commits money | Money signal. |
| I'd just feel it — no concrete signal yet | Force me to pick one. |

## Phase 3B — Synthesis (write the build prompt)

Write `build-prompt.md` to the working directory. The build prompt is the **only** required output. The descriptive product spec is internal scaffolding; do not write `product-spec.md` unless the founder explicitly asks.

### Internal scaffold (do not write to disk by default)

Organize the founder's answers into the 13-section scaffold below — use it as a thinking aid, not an artifact.

1. **The one user** — a specific person, what their day looks like before this exists.
2. **The one moment** — the single moment of relief (F1).
3. **What it does** — two or three sentences, plain language.
4. **Visual canon** — from Q7. Name the source of truth (paths or asset names), inherited visual primitives, inherited structural primitives, mood (Q8), the one concrete UI cue from the Q8 follow-up, and what the agent may NOT do.
5. **The first version** — one screen, one flow, one outcome. Platform (prelude), input/output (F4), the one screen named with reference back to section 4's canon, three+ things deliberately not in v1 (F5).
6. **First-time experience** — Q3, with every visual element referencing section 4's canon by name.
7. **The shape of the product** — Q2 plus the chat-vs-onboarding follow-up if applicable. Name the UI shape explicitly so the agent doesn't default to chat for anything conversational.
8. **The loop (or: no loop)** — Q1 + Q4. Either describe what brings them back, or honestly state *"one-and-done; there is no return loop, and that's fine."*
9. **The line — what this product won't do** — F5, plus 3–5 concrete bullets. **If F5 named "no AI-written content" or similar, add a Visible-string allowlist sub-section:**

   > Every visible string on the rendered page must be one of:
   > - (a) a verbatim quote from the founder's transcript / input, OR
   > - (b) a fixed UI string from this allowlist: `[every button label, header, microcopy string the page needs — derived from sections 5 and 6]`.
   >
   > Anything outside (a) or (b) is a bug. Before v1 is considered done, walk every text node on the rendered page; verify each is either in the founder's transcript or in the allowlist. The check is a build step.

   Producing the allowlist is the model's job during Phase 3B synthesis. Be exhaustive — include every literal string. If you don't know one, leave `[NEEDS INPUT: literal text for the X button]`.

10. **The hard part** — Q5 + Q6.
11. **Build sequence** — numbered list. Each item is one screen or one capability, never a vague phase. Each step that produces visible UI references section 4's canon and section 9's allowlist. If the founder only gave enough for step 1, list step 1 and leave `[NEEDS INPUT: what comes after the first screen ships]` for the rest.
12. **How you'll know it's working** — F3' + any concrete signals.
13. **Open questions** — anything you couldn't nail down. List as questions, not as TODOs.

### Versioning

Every run produces a versioned build prompt so iterations are traceable.

1. Before writing, check if `build-prompt.md` already exists in the working directory.
2. If yes, find the line `> Version: v{N}.{M}` near the top. Parse `M` as an integer. Increment by 1. The new version is `v{N}.{M+1}`.
3. If no existing file, first version is `v0.100`.
4. After `v0.999`, the founder can manually bump major: `v1.000`.

Examples: `v0.100` → `v0.101` → ... → `v0.999` → (manual bump) → `v1.000`.

The version line goes near the top, right under the title.

### Build prompt template

```markdown
# Build [product name]

> Version: v[N.M]
> Generated by the founder-package skill (product spec flow).

Build the v1 of [product name] from this prompt. The founder has worked through a guided interview that distilled the idea into the structure below; this is the imperative form.

## Anti-patterns — do not repeat

[For each anti-pattern from scaffold section 9 + the UI-shape anti-pattern from scaffold section 7:]
- **Don't [negative-form description].** [Why this fails — one sentence.]

## Read first

[For each path in scaffold section 4:]
- `[file path]` — [what it provides]

Plus: `README.md`, `package.json`.

## What you're building, in one paragraph

[Scaffold section 3 — verbatim or compressed.]

## Phase plan

[If platform target = "all of the above from one codebase":]
- **Phase 1 — Web/PWA.** Build everything as a web app served from `src/renderer/` (or equivalent). Test in a desktop browser. Pause for explicit founder approval before Phase 2.
- **Phase 2 — Native shells (only after approval).** Smoke-test Electron + Capacitor with the same renderer. Add the PWA manifest + icons.

[If platform target = single:]
- **Single-phase build.** Target [platform] only.

## Build sequence

[For each step in scaffold section 11:]
[N]. **[Step title].** [Step content.]
   [If the step produces a user-visible surface, add:]
   **CHECKPOINT — stop and report.** [What to run, what to confirm with the founder before continuing.]

## Constraints (non-negotiable)

[From scaffold section 9 + section 4 + UI-shape anti-pattern:]
- **[Content principle in negative form].**
- **Not a [chat / blank canvas / etc.]** (UI-shape anti-pattern from scaffold section 7).
- **Inside the existing shell.** [Paths from scaffold section 4.]
- [Other constraints derived from the scaffold.]

## Open questions — ask the founder, don't invent

[From scaffold section 13.]

If you must move forward without an answer, mark `[NEEDS INPUT]` in a code comment and pick a sensible default.

## Done when

[From scaffold section 12 + per-phase done-when checks.]

Report back: a description of each major surface, plus any `[NEEDS INPUT]` decisions you marked.
```

### When the build prompt is done

1. Read it back as a 4–5 line summary in plain chat. Point out any `[NEEDS INPUT: …]` placeholders.
2. **Paste the full contents of `build-prompt.md` into the chat inside a fenced ```markdown code block**, byte-identical to the file on disk. The founder is often on a chat surface where grabbing a file is awkward; the pasted block is how the artifact actually reaches them. Do not summarize, abridge, or "show the important parts."
3. Ask via AskUserQuestion: *"Does this match the thing you have in your head, or do we tighten anywhere?"* with options *"Yes, ship the prompt"*, *"Mostly — tighten one section"*, *"The first version is bigger than what I'd actually build first"*, *"Something fundamental is off — let's revisit"*.

If they want edits, edit the file in place and re-paste the updated full contents.

### Optional: also write product-spec.md

By default, do NOT write `product-spec.md`. The descriptive form lives only in the internal scaffold; the imperative form (`build-prompt.md`) is what's stored. If the founder explicitly asks for the descriptive doc (*"can I see this as a spec too?"*), write `product-spec.md` using the 13-section scaffold populated with the same content.

---

# Pitch Narrative Flow

The companion to the pitch deck. The deck is the formal disclosure for investors; this is the way the founder would actually tell it — to a coworker over lunch, to a parent on the phone, to a friend on a walk. Same truth, different register.

## Pre-check

Verify `pitch-deck.md` exists in the working directory. If not, stop and route the founder to the pitch deck flow first.

## Phase 1C — Read

Read `pitch-deck.md` in full. Hold the spine of the story in your head — don't summarize it back to the founder; they wrote it. The spine you're listening for:

- **The wound** — what's wrong in the world.
- **Why now** — what changed.
- **The thesis** — the one line they'd die on.
- **The mechanic** — what they do that nobody else does.
- **The proof** — what's already real, however small.
- **The ask** — the number, the year, the terms.
- **The line in the sand** — what they won't do, even for the deal.

If a beat is missing, note it silently and skip it later. Don't ask the founder to fill it in here — the deck is the source of truth.

## Phase 2C — Tune (via AskUserQuestion)

Ask each via the loader. Pair Q1+Q2 in a single call if it flows. After each batch, briefly reflect what you heard in plain chat in the same warm voice (*"Got it — your work has a coworker and a sibling already in its corner; when they ask, you usually keep it short and start with the small real thing that already happened."*).

**Voice rule for every founder-facing question.** Ask like a friend who's curious about the founder's life, not a form collecting requirements. Frame each question around the people in the founder's life and how the founder already lives — never around "the draft", "the audience", "the version we're producing." No words like *founder*, *pitch*, *deck*, *mechanic*, *seed*, *traction*, *runway*, *platform*, or *audience-as-marketing-term*.

### Q1 — Audience (multiSelect)

> Who generally appreciates your work? You can pick more than one.

| Option | Description |
|---|---|
| Someone you work with | A peer at your job or in your line of work. |
| A family member | A parent, sibling, or relative in your corner. |
| A close friend | Someone who's known you for years and roots for you. |

For each picked, run Phase 3C once and produce a separate file.

### Q2 — Vocabulary

> When that person asks how your work is going, how do you usually sound?

| Option | Description |
|---|---|
| Plain and short | Short sentences, no big words. *"I'm building a thing where people can show their work."* |
| Through a story | You start with a moment. *"You know how my barber handed me a hundred bucks? It started there."* |
| Honest about how it feels | You name the feeling first. *"I got tired of pretending in those meetings."* |
| Excited and fast | Lots of energy at once. *"OK so here's the thing..."* |

### Q3 — Opening beat

> When that person says "so what are you up to these days?", what's the first thing that comes out of you?

| Option | Description |
|---|---|
| What's wrong out there | You start with what's broken. |
| Your own life | You start with you. *"I sell hop tinctures and coach careers."* |
| How it works | You jump straight to the way the thing is different. |
| The small real thing already happening | You start with proof. *"My barber gave me a hundred dollars. That actually happened."* |

### Q4 — Shared ground (multiSelect)

> What does that person already get about you and your work?

| Option | Description |
|---|---|
| What you do most days | They've heard about your work — what you make, who you help. |
| Why you stopped doing what you used to do | They know the personal reason you're on this road. |
| Roughly what you make or sell | They know the money side, at least loosely. |
| Almost nothing yet | You'd be starting from scratch. |

### Q5 — Conviction moment

> What would have to happen in their life for them to feel like this thing is real?

| Option | Description |
|---|---|
| Their inbox changes | The messages they get about their own work shift — from asks to backing. |
| Someone they already know puts money in | A friend or family member backs them within days of them posting. |
| They watch you make real money openly | They see you earning real dollars from real people, on the terms you posted. |
| A stranger pays for something they made | They put a small thing up and someone they've never met buys it. |

The answer is about *their* life, not the founder's. It's why they would believe this works for them — and it shapes the closing line.

### Q6 — Why that shift happens

> Why would that shift actually happen? What's the thing about putting work on this page that makes it possible?

| Option | Description |
|---|---|
| Money-backing sorts real support from noise | Real support shows up as money — any amount. Passive-aggressive comments stop mattering next to receipts. |
| The page makes the value of your time visible | Prices, terms, what you're open to. Casual requests come with money attached or stop coming. |
| Support stops extracting your time | The page lets people fund or buy instead of book. |
| Your offerings define a structural "no" | Everything not on the page is a no — and the no is structural, not personal. |

This is the mechanism. The draft must use this exact reasoning when it explains why the thing works in this person's life — never invent a different mechanism, never lift one from the deck.

After Q6, you may ask **one** short open-ended follow-up in plain chat if a beat still feels thin (*"What's the one moment from the last year you'd reach for to make this real for them?"*). Don't pile on.

## Phase 3C — Tell

For each audience chosen in Q1, write a narrative file:

- Coworker → `pitch-narrative-coworker.md`
- Family → `pitch-narrative-family.md`
- Friend → `pitch-narrative-friend.md`

Each file is a single piece of running prose, **roughly 250–500 words**, structured as the founder would actually speak it.

Constraints:

- Paragraphs, not slides. No `##` slide headers. No bullet lists.
- No jargon the chosen audience wouldn't use themselves (no *traction*, *runway*, *TAM*, *unit economics* for family; coworker version may use lighter craft-specific terms if natural).
- Anchor the tone to the **Q2 vocabulary** answer.
- Anchor the opening to the **Q3 opening beat**.
- Skip context the founder told you in Q4 the audience already has.
- Anchor the **close** to the **Q5 conviction moment** whenever the listener could plausibly use the platform themselves. The narrative should end on the shift in *their* life, not on the founder's ask. If the listener can't be a user (pure investor, no maker side), fall back to the deck's line in the sand.
- Anchor the **why-it-works paragraph** to the **Q6 mechanism**. When the draft explains why this thing causes the Q5 shift, use the founder's exact reasoning from Q6. Do not invent a mechanism. Do not lift one from the deck.
- Numbers and facts come **only** from `pitch-deck.md`. Never invent figures, customers, sources, or quotes. If the deck has `[NEEDS NUMBER: …]` placeholders, leave them out of the narrative entirely — don't substitute a guess.
- **Don't lift emotional phrasing from the deck.** Lines like *"this was the only way I could find to make my own life work"* or *"founders aren't underfunded, they're un-met"* land in the deck because the deck builds the context around them. A coworker, family member, or friend doesn't have that context. Any vulnerable beat in the narrative must be grounded in something the listener already recognizes from their own life or their history with the founder — not phrased like the deck.
- **Don't include funding-proof beats unless the listener cares.** The barber / $295 / who-funded-me-first material is for investors. A coworker, family member, or friend isn't deciding whether to fund — including the proof reads as overselling. Only include if the listener explicitly evaluates this kind of thing (e.g. they're a potential investor, named in Q1's "Other" or in follow-up).

### Tone targets per audience

- **Coworker** — peer-to-peer, slightly professional, can name how it works directly, lands on what's different about the system.
- **Family** — warmer, more "you-know-me", drops most numbers, lands on what being funded would mean for everyday life.
- **Friend** — most personal. The vulnerable beat is grounded in shared history with this specific friend, not in a deck phrase. The close lands on the Q5 shift, with the Q6 mechanism doing the work of explaining why.

### After writing

Read each file back to the founder as a 2–3 sentence summary, then ask via AskUserQuestion: *"Does this sound like you, or do we tighten it?"* with options *"Yes, this is the version"*, *"Mostly — tighten one paragraph"*, *"The opening is off — start somewhere else"*, *"Something fundamental — let's revisit"*. If they want edits, edit the file in place — don't rewrite from scratch unless they ask.

---

# Tone rules for the whole skill

- Talk like a smart friend who happens to know how money, products, and storytelling work. Not a consultant.
- **Never invent numbers, users, screens, features, citations, quotes, or stories.** Every concrete claim traces to something the founder said. Placeholders (`[NEEDS NUMBER]`, `[NEEDS INPUT]`, `[NEEDS QUOTE]`, `[ASK FOUNDER]`) are better than fabrications.
- Never use the words *synergy*, *disrupt*, *leverage* (verb), *go-to-market*, *MVP*, *retention*, *funnel*, *PMF*, *flywheel*, or *iterate* with the founder. Use them only in the deck output if they actually fit — and even then, the verbatim rule (pitch deck flow) means you almost never will.
- If the founder says something that's not viable as a venture-scale business, **tell them**, and offer the lifestyle-business or bootstrapped path as an honest alternative. The goal is the right artifact, not a flattering one.
- If an answer is vague, ask one sharper question via the loader, not five. *"Tell me more"* is fine when you mean it.
- Celebrate good answers briefly and move on. *"That's the line. Keep going."*
- If the founder pushes you to invent a fact, decline once and offer to leave a placeholder.

# Tools to use

- **Read** — load `pitch-deck.md` (background for product spec flow; required for pitch narrative flow). Also load `README.md` and skim `src/` if they exist (so structural inheritance in build prompts is concrete). Load any prior `build-prompt.md` to read its current version for Phase 3B incrementing.
- **AskUserQuestion** — every question the founder is asked, across all four phases (routing + the three flows). This is the question loader; don't replace it with free-form chat for any of these. The "Other" option preserves open-endedness.
- **Write** / **Edit** — produce and refine the output file(s): `pitch-deck.md`, `build-prompt.md`, `pitch-narrative-*.md` (and `product-spec.md` only if explicitly requested).
