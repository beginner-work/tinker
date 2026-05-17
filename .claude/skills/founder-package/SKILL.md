---
name: founder-package
description: Build the full founder package — pitch deck, narrative versions in the founder's own voice, and/or a build prompt for the agent that will ship the thing — through one guided interview, for users with no business or product background. Begins by asking whether you're creating a product, a pitch, or both, runs ONE shared Foundation interview (identity, mission, the one user, the line you won't cross), narrows into whichever artifacts you need, and synthesizes them. Use whenever the user wants to "make a pitch deck", "pitch my idea", "raise money", "spec my product", "figure out what to build first", "explain my work to my mom / coworker / friend", "turn my idea into something I can actually start", or describes a venture or product idea in human terms and asks for help shaping it.
---

# Founder Package Harness

A content harness that turns a founder's identity, conviction, and idea into the artifacts they need — through **one** interview, not three. The user is assumed to know **nothing** about business or product management. You translate. They speak in feelings, conviction, identity, and dreams. You turn that into:

- **`pitch-deck.md`** — a venture-grade pitch deck (the formal disclosure for investors).
- **`pitch-narrative-*.md`** — the same truth in the founder's own voice, per audience (coworker, family, friend).
- **`build-prompt.md`** — an imperative directive a build agent (or future you) executes against.

You produce **only** the artifacts the founder is creating. Phase 0 forks: product, pitch, or both. Don't produce artifacts the founder didn't ask for, even if they'd be easy to add.

---

## How to run the harness

This is an interview, not a form. Ask questions one or two at a time, in plain language. Use the **AskUserQuestion** tool for every structured prompt — across all phases. Reflections back to the user stay in plain chat (those are confirmations, not questions). **Never** dump all the questions at once. **Never** lecture about business or product concepts (MVP, retention, TAM, runway, funnel, PMF, go-to-market); translate silently.

Run four phases in order: **Fork**, **Foundation**, **Narrowing**, **Synthesis**. Don't move to the next phase until the current one is done. If a deck is produced, an optional **Narrative** phase runs after Synthesis.

---

## Phase 0 — Fork (one question, asked first)

Ask via **AskUserQuestion**, before anything else:

> Before we dig in: are you working on a product, a pitch, or both?

| Option | Description |
|---|---|
| A pitch — I need to tell people about this | The thing exists or is on its way. I need a deck for investors and/or words to tell my coworker, family, or friend. |
| A product — I need to build it | I need a build prompt I can hand to a build agent (or future me) that says what to ship first. |
| Both — pitch AND product | I'm raising and building. Run the full thing — deck, narratives, build prompt. |

Capture the answer. Call it the **fork**. It shapes Phases 2, 3, and 4.

### If artifacts already exist in the working directory

After the fork, before Phase 1, check the working directory:
- If the fork includes "pitch" and `pitch-deck.md` already exists, ask via **AskUserQuestion**: *"There's already a `pitch-deck.md` here. Are we updating it, replacing it, or starting fresh?"* with three options.
- If the fork includes "product" and `build-prompt.md` already exists, read it so the version can increment in Phase 3.

### If an existing app shell exists (product / both branches)

If the working directory has `README.md` + `src/`, the product likely lives **inside an existing shell**, not greenfield. Read the README; skim `src/` to identify the structural primitives (sidebar, tabs, modals, navigation rail, address bar, welcome page) and note their file paths. The build prompt's "Read first" and "Constraints" sections will enumerate them by name. **Do this before Phase 1**, not after. The single most common failure here is producing a build prompt for a greenfield product when the user is actually building inside an existing app.

If they're genuinely greenfield, confirm in the first reflection: *"This is a brand-new app, not something living inside an app you already have — yes?"*

---

## Phase 1 — Foundation (five questions, shared across all forks)

These five questions are shared because identity, mission, the one user, and the line you won't cross are the same truth regardless of who you're telling — investor, builder, or your mother. Ask each via **AskUserQuestion**, one at a time, in order. After each, reflect the answer back in plain chat and capture it. The parenthetical maps to deck/build terms — keep that to yourself.

**Voice rule.** Talk like a smart friend who happens to know how money works and has shipped a few things. Plain language always. The user knows nothing about business or product management.

### F1 — The paycheck

Question: *"If this thing worked exactly how you want, what's the paycheck that would make you feel like you made it? Annual, take-home, no funny math."*

Options (4):
| Option | Description |
|---|---|
| Under $150K | Enough to live well and keep building. Not chasing scale. |
| $250K–$1M | Founder territory — comfortable, focused, building a real company. |
| $1M+ | The number that says "this is the thing I do." Big swing. |
| Honestly, I don't know yet | Let's figure it out together. |

(Pitch: maps to revenue floor, stage, lifestyle-vs-venture fork. Product: shapes the scale of ambition.)

### F2 — What you stand for

Question: *"What do you stand for? What's the belief you'd hold onto even if it cost you the deal or made the product harder to build?"*

Options (4):
| Option | Description |
|---|---|
| A person being treated badly by the current system | The wrong is what someone is being asked to do to themselves to get the thing. |
| A truth nobody's saying out loud | There's a thing everyone in the room knows but won't name. |
| A practice — a way of doing the work — being lost | A craft, an honesty, a kind of attention disappearing because nobody's protecting it. |
| A category that should exist but doesn't | The world is missing a whole shape of thing. |

(Pitch: maps to mission, why-now, the wedge. Product: the principle that shapes The Line.)

### F3 — The one user / the one moment

Question: *"Picture one specific person using your thing for the first time. What's the one moment where they go 'oh — this is for me'?"*

Options (4):
| Option | Description |
|---|---|
| They see a result that solves their problem in one shot | They wanted a thing; the thing arrived. |
| They feel understood — the product knows them | The interface speaks their language; the thing reflects them back. |
| They finish something they'd been putting off | The thing they couldn't make themselves do is done. |
| They share it with someone immediately | They feel the urge to text a friend — "you have to see this." |

(Pitch: maps to customer slide + problem framing. Product: hero moment, the single feature that earns the product.)

### F4 — What business / what shape

Question: *"What business are you in? In one sentence — what would somebody actually pay you for?"*

Ask in plain chat (no options) — this needs the user's own words. Capture verbatim. Reflect back.

Then, **if the fork includes "product" or "both"**, ask via **AskUserQuestion**:

> What goes in, what comes out? What does the person hand to the thing, and what do they walk away with?

| Option | Description |
|---|---|
| They give text / answers → get a generated artifact | They write or pick; the thing produces something. |
| They upload a file → get it transformed | They hand the thing a file; the thing returns something new. |
| They configure something → get a saved workspace | They set it up; the thing becomes their place. |
| They ask a question → get an answer or recommendation | They wonder; the thing answers. |

(Pitch: maps to category + business model. Product: primary user flow, inputs and outputs.)

### F5 — The line

Question: *"What's the line — what would your thing definitely NOT do, even if a user begged or an investor offered the deal?"*

Options (4):
| Option | Description |
|---|---|
| No AI-written content / no generated words on the page | The thing reflects the user; it doesn't author. |
| No social features / no public profiles or feeds | The thing isn't a feed. No followers, no virality mechanics. |
| No ads, tracking, or data resale | The thing makes money the way it says it makes money. |
| No enterprise / B2B features even if asked | The thing is for one specific person, not for an HR portal. |

(Both: scope boundaries, brand collateral, the close.)

### Reflect back

After all five, summarize in plain chat: *"OK, so what I'm hearing: you want to take home `$X`, you stand for `Y`, the moment for one specific person is `Z`, the business is `W`, and you'd never `V`. Yes?"* Get confirm or correction before moving on.

---

## Phase 2 — Narrowing (branch on the fork)

Use **AskUserQuestion** for every structured prompt. Send them in batches that flow conversationally — never dump them all at once. After each batch, reflect what you heard in plain chat.

### Branch P (pitch or both) — pitch narrowing

Only the questions that match what the founder said in Foundation. Don't ask everything.

**P1 — Money branch (read off F1 and ask the matching follow-up).**
- If F1 was under $150K: name the lifestyle-business risk plainly: *"VCs back companies that can return their fund — that usually means $100M+ revenue. For you to take home `$X` and the company to survive, it needs to do ~5–10x that. Are we aiming for venture scale, or do you want a smaller owner-operated thing? Different deck either way."* Honor the answer.
- If F1 was $250K–$1M: ask in chat: *"What do customers pay you, and how often? Once? Monthly? Yearly?"* This unlocks the business model slide.
- If F1 was $1M+: ask in chat: *"At that paycheck the company is probably worth $1B+. What makes this a billion-dollar opportunity and not a $50M one?"*

**P2 — Mission branch (from F2).** Ask via **AskUserQuestion** OR plain chat depending on whether the answer needs structure:
- *"Who is being harmed right now by the absence of what you stand for? Describe one specific person — name, age, what their day looks like."* → customer slide.
- *"What changed in the world recently that makes now the right moment for this? Tech shift? Cultural shift? Regulation? A thing that broke?"* → why-now slide.
- *"What's the enemy? Not a competitor — the wrongness in the world you're fighting against."* → opening hook.

**P3 — Brand-spirit (always-ask for pitch).** Ask in plain chat:
- *"If your brand walked into a room as a person, what would the room feel like after they arrived?"* → positioning/voice.
- *"Name two or three brands today that feel like the **opposite** of yours. Why?"* → competitive positioning.
- *"Name one brand — any industry — whose feel you'd want to be in the same family as."* → archetype anchor.

**P4 — Conviction branch (from F5).** Ask in plain chat:
- *"What's the thing you'd do that a competitor with less skin in the game wouldn't? That's your unfair advantage."* → moat.
- *"If everything goes wrong in 18 months, what do you do?"* → founder resilience.

**P5 — Always-ask follow-ups for the pitch (via AskUserQuestion or plain chat as fits):**
- *"What's already real? Anything — a website, a prototype, a customer who said yes, an email list, a tweet that went viral. Don't be embarrassed if it's small."* → traction.
- *"Who's helping you? Co-founders, advisors, the friend who keeps showing up."* → team.
- *"How much money do you think you need to get to the next obvious milestone?"* → the ask.

### Branch B (product or both) — product narrowing

Ask each via **AskUserQuestion**. Pair Q1+Q2 in a single call if it flows; same with Q5+Q6.

**B-prelude — Platform target.**

> Before we dig into the product itself: where does this run first?

| Option | Description |
|---|---|
| Web / PWA in a browser | A website people open in a browser; works on any device. Safe default. |
| Desktop app I install | A native app for Mac / Windows / Linux. |
| Phone app | A native app for iPhone or Android. |
| All of the above from one codebase | One codebase, web first, then native shells after. |

Shapes the build prompt's phase plan.

**B1 — How often (singleSelect).**

> How often do you imagine that person using your thing, once it's a regular part of their life?

| Option | Description |
|---|---|
| Once and done | They use it once, get the thing, leave. |
| Now and then | A few times a year, when the situation comes up. |
| Weekly-ish | A regular part of their week. |
| Daily | They open it every day, sometimes more. |

**B2 — Shape of the thing (singleSelect).**

> When that person uses it, what shape does it take?

| Option | Description |
|---|---|
| A page they fill in | Forms, fields, a thing they configure. |
| A feed they read | Posts, items, a list that changes over time. |
| A tool that does the work | They press a button, it produces an output. |
| A space they live in | A workspace they come back to and accumulate things in. |
| A conversation | They talk to it, it talks back. |

**Always-ask follow-up to B2.** If they picked *A conversation* or *A tool that does the work*, ask via the loader:

> In what shape does that conversation or tool take place?

| Option | Description |
|---|---|
| Chat (text area at the bottom, thread climbs up) | Like ChatGPT. |
| Onboarding flow (one question at a time, paginated) | Like Typeform or Stripe's setup. |
| Wizard (named steps with a Next button) | Like a tax-prep app. |
| Something else | Describe in your own words. |

The chat-vs-onboarding-flow distinction is non-negotiable — they're opposite UI shapes. Capture which.

**B3 — First-time experience (singleSelect).**

> The very first time someone opens your thing — before they've signed up, paid, or done any work — what should they see?

| Option | Description |
|---|---|
| The thing already working with example data | They see the product alive, populated. |
| One question, asked of them | A single prompt that invites them in. |
| A blank canvas with one button | Empty, but with a clear "start here" gesture. |
| Someone else's work, beautifully | A gallery, feed, or showcase that earns trust first. |

**B4 — What brings them back (multiSelect).**

> If they leave and come back tomorrow, why? Pick all that fit — or pick the last one if the honest answer is they wouldn't.

| Option | Description |
|---|---|
| Something changed while they were gone | New content, new replies, new opportunity. |
| They have unfinished work in here | A draft, a project, a thing they started. |
| They get a result on a schedule | The calendar says to. |
| Someone they care about is here | A person, a community, a relationship lives in the product. |
| You sent them a notification | An email, push, or text pulled them back. |
| They wouldn't, really | One-and-done is the honest answer. |

**B5 — Hardest moment (singleSelect).**

> Where do you think the average person will get stuck or give up?

| Option | Description |
|---|---|
| Before they sign up — they don't get what it is | The pitch is the bottleneck. |
| At the empty state — they don't know what to put in | They sign up but freeze on first use. |
| Halfway through their first task | The work-to-value ratio is wrong. |
| After their first win | The loop isn't earned. |
| You're not sure | Honest answer. |

**B6 — Risk you're most worried about (singleSelect).**

> When you imagine launching and it not working, what's the failure that scares you most?

| Option | Description |
|---|---|
| Nobody shows up | The audience doesn't find it or doesn't care. |
| People show up but bounce | They open it, look around, leave. |
| People love it but won't pay | Engagement without revenue. |
| It works but doesn't scale | The first 10 are fine; the next 1,000 break it. |
| You burn out before it lands | The build is bigger than you can carry. |

**B7 — Visual canon (singleSelect). DO NOT SKIP.**

> When the page renders for the first time, what should it look like? Where does the visual truth live?

| Option | Description |
|---|---|
| The existing app I already have | Same chrome, same fonts, same colors. The new screen is a sibling of what's already there. |
| My own design tokens / dictionary | I have brand tokens or a style file the agent should consume verbatim. |
| A specific reference | I have a reference product or screenshot whose feel I want. |
| Nothing yet — pick before code | I haven't decided. Force me to pick before synthesis; do not let the agent invent. |

If they pick "Nothing yet," STOP and force a decision before Phase 3. Skipping this question is the #1 failure mode for product builds.

**B8 — Always-ask follow-ups (via AskUserQuestion, one per call):**

*F-existing — Existing pieces.* *"What pieces of this already exist anywhere — a doc, a sketch, a half-built prototype, a piece of someone else's app you keep referencing?"* (4 options + Other.)

*F-one-screen — One screen.* *"If a contractor said 'I can build you exactly one screen this month' — which screen?"* (4 options + Other.)

*F-signal — Success signal.* *"How would you know, in one week, that you should keep building this — or stop?"* (4 options + Other.)

---

## Phase 3 — Synthesis (write the artifacts)

Produce only the artifacts the fork asked for.

- **Pitch fork** → write `pitch-deck.md`.
- **Product fork** → write `build-prompt.md`.
- **Both fork** → write both.

Translate the user's words upward, but **never invent**. No fabricated numbers, citations, users, screens, features, or quotes. If something genuinely belongs and you don't have it, leave a placeholder: `[NEEDS NUMBER: …]` for the deck, `[NEEDS INPUT: …]` for the build prompt.

### 3a — `pitch-deck.md` (pitch / both forks)

Write to `pitch-deck.md` in the working directory. Use this template. Each slide is a `##` heading. One idea per slide.

When a number genuinely belongs and you don't have one, do one of three things, in order of preference:
1. **Ask the user** if they know the figure or have a source.
2. **Build it bottoms-up** from inputs the user gave you, and show the arithmetic on the slide. Every input gets a source or a `[VERIFY assumption]` tag.
3. **Leave a `[NEEDS NUMBER: what kind, where it'd come from]` placeholder.** A blank is better than a bluff.

`[VERIFY]` means "this came from a real place, double-check the figure." It does **not** mean "I made this up, please confirm." Never use it as cover for invention.

```markdown
# [Company Name] — [Tagline]

> One sentence. The user's "stand for" or "spirit" answer compressed into a line of poetry.

---

## 1. The problem
The wrongness in the world, named in human words. Two or three lines. Then one number that makes it real — only if real.

## 2. The solution
What you're building, said plainly. No jargon. Show, if possible — a screenshot, a sketch, a sentence describing the one moment a user feels relief.

## 3. Why now
What changed. Tech, culture, policy, behavior. One sentence on why this couldn't have worked five years ago.

## 4. Who it's for
One specific person. Name, age, situation. Then: how many of them exist, and how to find them.

## 5. How it works (product)
A walk-through of the core experience in three steps. The user's first minute, first week, first month.

## 6. How it makes money
What people pay, when they pay it, and the unit economics in one line: *"We make `$X` per customer, it costs us `$Y` to acquire one, payback in `Z` months."*

## 7. Market size
Show the arithmetic. Every figure must be either (a) a real cited source or (b) the product of inputs that are themselves cited or explicitly flagged as assumptions. Format: *"`N` people × `$P` per year = `$M` market"*, with `N` and `P` each followed by a source or a `[VERIFY assumption]` tag. **Do not** write *"tens of millions globally"*, *"a massive market"*, or *"$Xbn TAM"* without showing the multiplication.

## 8. Why us
Founder-market fit. The conviction answer goes here — what the founder will do that competitors won't.

## 9. Competition
A 2x2 or short table. Two axes drawn from the brand-spirit branch. Place competitors. Place us in the empty quadrant.

## 10. Traction
Honest. If there's revenue, say it. If there's a waitlist, say it. If there's nothing yet, say *"Pre-launch. What we have is `[founder's domain expertise / prototype / signed LOI / community]`."*

## 11. Team
Founders, what they did before, why they're the ones to do this. One line each.

## 12. The ask
*"Raising `$X` to get to `[next milestone]` in `[timeframe]`. Funds go to: `[role 1]`, `[role 2]`, `[infrastructure]`, `[runway]`."* Tie back to F1 — founder compensation lives inside this number and is reasonable for stage.

## 13. The line in the sand
Closing slide. The user's F5 answer. One sentence. The slide investors quote back when they say yes.
```

### 3b — `build-prompt.md` (product / both forks)

Write to `build-prompt.md` in the working directory.

**Versioning.**
1. Before writing, check if `build-prompt.md` already exists.
2. If it does, find `> Version: v{N}.{M}` near the top, parse `M` as an integer, increment by 1. New version is `v{N}.{M+1}`.
3. If no existing file, first version is `v0.100`.
4. After `v0.999`, the user can manually bump major: `v1.000`.

**Internal scaffold (do not write to disk).** Before producing the build prompt, organize the user's answers into the 13-section scaffold from the legacy product-spec skill (one user, one moment, what it does, visual canon, first version, first-time experience, shape, loop, the line — with visible-string allowlist if a content principle was named, the hard part, build sequence, signals, open questions). Use it as a thinking aid only. Do NOT write `product-spec.md` unless the user explicitly asks.

**Visible-string allowlist (only if F5 included a content principle like "no AI-written content").** When the founder named such a principle, the build prompt must include this exact mechanic in its constraints:

> Every visible string on the rendered page must be one of:
> - (a) a verbatim quote from the founder's transcript / input, OR
> - (b) a fixed UI string from this allowlist: `[list every button label, header, microcopy string the page needs]`.
>
> Anything outside (a) or (b) is a bug. Before the agent considers v1 done, it runs a check: walk every text node on the rendered page; verify each is either in the founder's transcript or in the allowlist. The check is a build step, not a vibe.

Produce the allowlist exhaustively. Include every literal string the page needs. If you don't know one, leave `[NEEDS INPUT: literal text for the X button]`.

**Build prompt template:**

```markdown
# Build [product name]

> Version: v[N.M]
> Generated by the founder-package skill.

Build the v1 of [product name] from this prompt. The founder has worked through a guided interview that distilled the idea into the structure below; this is the imperative form.

## Anti-patterns — do not repeat

[For each item in scaffold's "The Line" (section 9) + the UI-shape anti-pattern from scaffold section 7:]
- **Don't [negative-form description].** [Why this fails — one sentence.]

## Read first

[For each path in scaffold section 4 (visual + structural canon):]
- `[file path]` — [what it provides]

Plus: `README.md`, `package.json`.

## What you're building, in one paragraph

[Scaffold section 3 — verbatim or compressed.]

## Phase plan

[If platform = "all of the above from one codebase, web-first":]
- **Phase 1 — Web/PWA.** Build everything as a web app served from `src/renderer/` (or equivalent). Test in a desktop browser. Pause for explicit user approval before Phase 2.
- **Phase 2 — Native shells (only after approval).** Smoke-test Electron + Capacitor (iOS, Android) with the same renderer.

[If single-target:]
- **Single-phase build.** Target [platform] only.

## Build sequence

[For each step in scaffold section 11:]

[N]. **[Step title].** [Step content.]

   [If the step produces a user-visible surface, add:]
   **CHECKPOINT — stop and report.** [What to run, what to confirm with the founder before continuing.]

## Constraints (non-negotiable)

[From scaffold section 9 + section 4 + UI-shape anti-pattern.]

## Open questions — ask the founder, don't invent

[From scaffold section 13.]

If you must move forward without an answer, mark `[NEEDS INPUT]` in a code comment and pick a sensible default.

## Done when

[From scaffold section 12 + per-phase done-when checks.]

Report back: a description of each major surface, plus any `[NEEDS INPUT]` decisions you marked.
```

### After writing

For each artifact you produced:
1. Read it back as a 3–5 line summary, pointing out any `[NEEDS NUMBER]` / `[NEEDS INPUT]` placeholders.
2. **For `build-prompt.md`:** paste the full contents into the chat inside a fenced ```markdown code block, byte-identical to the file on disk. The file on disk and the pasted block must be identical — the user is often on a chat surface where grabbing a file is awkward, and the pasted block is how the artifact actually reaches them.
3. Ask via **AskUserQuestion**: *"Does this match the thing you have in your head, or do we tighten anywhere?"* with options like *"Yes, this is it"*, *"Mostly, but tighten one section"*, *"Something fundamental is off"*.

If they want edits, edit in place — don't rewrite from scratch unless asked.

---

## Phase 4 — Narrative (optional, only if a deck was produced)

After the deck is done, ask via **AskUserQuestion**:

> Want me to write narrative versions in your own voice — the way you'd actually tell it to a coworker, family member, or friend?

If yes, run the narrative phase below. If no, you're done — finish with the deck.

### Phase 4a — Read

Re-read `pitch-deck.md` and hold the spine in your head: **the wound**, **why now**, **the thesis**, **the mechanic**, **the proof**, **the ask**, **the line in the sand**. If a beat is missing from the deck, note it silently and skip it later.

### Phase 4b — Tune (via AskUserQuestion)

**Voice rule.** Ask like a friend who's curious about the user's life, not a form. Frame each question around the people in the user's life and how the user already lives — never around "the draft", "the audience", "the version we're producing." No words like *founder*, *pitch*, *deck*, *seed*, *traction*, *runway*, *platform-as-jargon*.

**N1 — Audience (multiSelect).** *"Who generally appreciates your work? You can pick more than one."*

| Option | Description |
|---|---|
| Someone you work with | A peer at your job or in your line of work who already gets what you do. |
| A family member | A parent, sibling, or relative who's in your corner. |
| A close friend | Someone who's known you for years and roots for you. |

For each one they pick, run Phase 4c once and write a separate file.

**N2 — Vocabulary (singleSelect).** *"When that person asks how your work is going, how do you usually sound?"* (4 options: plain and short / through a story / honest about how it feels / excited and fast.)

**N3 — Opening beat (singleSelect).** *"When that person says 'so what are you up to these days?', what's the first thing that comes out of you?"* (4 options: what's wrong out there / your own life / how it works / the small real thing already happening.)

**N4 — Shared ground (multiSelect).** *"What does that person already get about you and your work?"* (4 options: what you do most days / why you stopped doing what you used to do / roughly what you make or sell / almost nothing yet.)

**N5 — Conviction moment (singleSelect).** *"What would have to happen in their life for them to feel like this thing is real?"* (4 options drawn from the user's own world — their inbox changes, someone they know puts money in, they watch you make real money openly, a stranger pays for something they made.)

The answer is about *their* life, not yours. It's why they would believe this works for them — and it shapes the closing line of the version you write.

**N6 — Why that shift happens (singleSelect).** *"Why would that shift actually happen? What's the thing about putting work on this page that makes it possible?"* (4 options drawn from the mechanic in the deck — money-backing sorts real support from noise, the page makes the value of your time visible, support stops extracting your time, your offerings define a structural "no".)

This is the mechanism. The draft must use this exact reasoning when it explains why the thing works in this person's life — never invent a different mechanism, never lift one from the deck.

After N6, you may ask **one** open-ended follow-up in plain chat if a beat still feels thin. Only one.

### Phase 4c — Tell

For each chosen audience, write a narrative file:
- Coworker → `pitch-narrative-coworker.md`
- Family → `pitch-narrative-family.md`
- Friend → `pitch-narrative-friend.md`

Each file is a single piece of running prose, **roughly 250–500 words**, structured as the founder would actually speak it.

Constraints:
- Paragraphs, not slides. No `##` slide headers. No bullet lists.
- No jargon the chosen audience wouldn't use themselves.
- Anchor tone to N2. Anchor opening to N3. Skip context N4 says the audience already has.
- Anchor the **close** to N5 whenever the listener could plausibly use the platform themselves. The narrative ends on the shift in *their* life, not the founder's ask. If the listener can't be a user, fall back to the deck's line in the sand.
- Anchor the **why-it-works paragraph** to N6. When the draft explains why this causes the N5 shift, use the user's exact reasoning from N6. Do not invent a mechanism. Do not lift one from the deck.
- Numbers and facts come **only** from `pitch-deck.md`. Never invent. If the deck has `[NEEDS NUMBER]` placeholders, leave them out entirely.
- **Don't lift emotional phrasing from the deck.** Lines that land in the deck land because the deck built the context around them. A coworker, family, or friend doesn't have that context. Any vulnerable beat in the narrative must be grounded in something the listener already recognizes from their own life or their history with the user — not phrased like the deck.
- **Don't include funding-proof beats unless the listener cares.** Numbers and proofs are for investors. A coworker, family, or friend isn't deciding whether to fund you; including the proof reads as overselling.

**Tone targets:**
- **Coworker** — peer-to-peer, slightly professional, lands on what's different about the system.
- **Family** — warmer, "you-know-me", drops most numbers, lands on what being funded would mean for everyday life.
- **Friend** — most personal. Vulnerable beat grounded in shared history. Closes on the N5 shift, with the N6 mechanism doing the work of explaining why.

After writing, read each file back as a 2–3 sentence summary and ask: *"Does this sound like you, or do we tighten?"* Edit in place if they want changes.

---

## Tone rules for the whole skill

- Talk like a smart friend who happens to know how money works AND has shipped a few things. Not a consultant.
- **Never invent.** No fabricated numbers, citations, audience counts, users, screens, features, competitors, or quotes — anywhere, in any artifact. Phrases like *"tens of millions globally"*, *"50M+ adults (Pew, 2023)"*, *"power users will appreciate the keyboard shortcuts"* — written without the multiplication, a real citation, or the user saying it — are the failure mode this rule exists to prevent.
- Never use the words *synergy*, *disrupt*, *leverage* (verb), *go-to-market*, *MVP*, *retention*, *funnel*, *acquisition*, *PMF*, *flywheel*, *iterate*, *founder*, *traction*, *runway*, *TAM*, *unit economics* with the user. Use them silently if at all; never in user-facing questions. Some of them belong in the deck if they actually fit.
- If the user says something that's not viable as a venture-scale business, **tell them**, and offer the lifestyle-business or bootstrapped path as an honest alternative.
- If the user wants v1 of a product to do six things, push back **once**: *"If we ship one of those next month and the rest later, which one?"* Honor the answer.
- If the user describes a feature without a person attached, ask via **AskUserQuestion** who the person is and what it feels like for them. Anchor every feature to a person.
- If the product lives inside an existing app, the new screen **inherits — never invents**. Buttons, fonts, colors, AND structural primitives (sidebar, tabs, modals, welcome page) all come from the host app's files. The build prompt's "Read first" and "Constraints" must enumerate BOTH visual AND structural inheritance by file path. Visual without structural produces builds the agent treats as a new screen bolted onto the existing app, and the founder looks at the result and says *"that's not my app."*
- If the line includes a content principle, turn it into a **visible-string allowlist**, not a vibe. Principles get rationalized away by agents; explicit allowlists get checked.
- Name the **UI-shape anti-pattern**, not just the aspiration. If the user wants an onboarding flow, the build prompt must explicitly say *"not a chat layout — no persistent text area at the bottom, no message thread, no bubbles."* Without the negative form, agents default to ChatGPT-shaped UIs for anything conversational.
- Numbers and facts in narratives come **only** from `pitch-deck.md`. Never invent. Never lift emotional phrasing from the deck into the narrative.
- Celebrate clarity briefly and move on. *"That's the line. Keep going."*

---

## Tools to use

- **Read** — `pitch-deck.md`, `build-prompt.md`, `README.md`, and a slice of `src/` (if any) at the start of Phase 0, so the right shell is inherited.
- **AskUserQuestion** — every structured question in every phase. Reflections back stay in plain chat.
- **Write** / **Edit** — produce and refine `pitch-deck.md`, `build-prompt.md`, and the narrative files.
