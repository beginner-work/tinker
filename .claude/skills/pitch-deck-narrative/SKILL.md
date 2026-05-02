---
name: pitch-deck-narrative
description: Translate an existing pitch-deck.md into the founder's own voice — the way they'd tell it to a coworker, family member, or friend. Reads pitch-deck.md, uses the structured question tool (AskUserQuestion) to surface tone, vocabulary, and stories per audience, and writes a narrative version alongside the deck. Use whenever the user wants to "tell my pitch like a human", "make this sound like me", "explain my pitch to my mom / my coworkers / my friends", "narrate the deck", or asks for a non-deck version of their pitch.
---

# Pitch Deck Narrative Harness

A companion to the `pitch-deck` skill. The deck is the formal disclosure for investors. This skill turns that same content into the way the founder would actually tell it — to a coworker over lunch, to a parent on the phone, to a friend on a walk. Same truth, different register.

## When to run

Run this skill when:
- `pitch-deck.md` exists in the working directory, **and**
- The user wants a narrative, conversational, or "in my own voice" version of the pitch.

If `pitch-deck.md` is missing, stop and tell the user to run the `pitch-deck` skill first. Do not invent a deck to narrate from.

## How it works

Three phases: **Read**, **Tune**, **Tell**.

---

## Phase 1 — Read

Read `pitch-deck.md` in full. Hold the spine of the story in your head — don't summarize it back to the user (they wrote it). The spine you're listening for:

- **The wound** — what's wrong in the world.
- **Why now** — what changed.
- **The thesis** — the one line they'd die on.
- **The mechanic** — what they do that nobody else does.
- **The proof** — what's already real, however small.
- **The ask** — the number, the year, the terms.
- **The line in the sand** — what they won't do, even for the deal.

If a beat is missing from the deck, note it silently and skip it later. Don't ask the user to fill it in here — the deck is the source of truth.

---

## Phase 2 — Tune (use AskUserQuestion)

This is where the question loader does the work. Use the **AskUserQuestion** tool for the four structured questions below. Send them in batches that make sense conversationally — never dump all four at once, but you may pair Q1+Q2 in a single call if it flows.

After each batch, briefly reflect what you heard ("Got it — coworker version, plain and short, opens on the mechanic.") so the user can correct before you start drafting.

### Q1 — Audience (multiSelect)

> Who is the version-of-the-pitch you want to draft right now?

| Option | Description |
|---|---|
| A coworker | Peer at work or in your industry — knows your skill set, doesn't know this project. |
| Family | A parent, sibling, or relative — cares about you, doesn't follow tech or business. |
| A close friend | Someone who's known you for years — wants the real, vulnerable version. |

If they pick more than one, run Phase 3 once per chosen audience.

### Q2 — Vocabulary

> When you talk to [audience] about work, which of these sounds most like you?

| Option | Description |
|---|---|
| Plain and short | Short sentences, few abstractions. *"I'm building a thing where founders show their work."* |
| Stories and analogies | Lead with a moment or comparison. *"You know how my barber gave me $100? It started there."* |
| Honest and a little raw | Names the feeling first. *"I got tired of pretending in pitch meetings."* |
| Excited and fast | High energy, lots of detail at once. *"OK so the thing is..."* |

### Q3 — Opening beat

> When [audience] asks "so what are you working on?", how do you actually open?

| Option | Description |
|---|---|
| The wound | Start with what's broken in the system. |
| Yourself | Start with your own life — what you sell, what you do, who's already paid you. |
| The mechanic | Start with what's different about how it works. |
| The proof | Start with the smallest real thing that already happened. |

### Q4 — Shared ground (multiSelect)

> What does [audience] already know about you and this work?

| Option | Description |
|---|---|
| What you do day-to-day | They've heard you talk about your craft, products, or coaching. |
| Why you left your old path | They know the personal reason behind this. |
| The numbers | They know roughly what you make, sell, or are raising. |
| Almost nothing | You'll need to set context from scratch. |

### Q5 — Conviction moment

> What's the one shift this audience would need to see in their own life for the platform to feel real to them?

| Option | Description |
|---|---|
| Their inbox changes | Requests for their time or services start arriving as seed money instead — *"$50, no strings, because I believe in what you're building"* replaces *"are you free Saturday?"* |
| Their close network seeds them | Someone they already know funds them within days of posting their offering. |
| The founder earns in public | They watch you make real revenue on the platform, on the terms you posted. |
| A stranger buys their thing | They put a small offering up and someone outside their circle pays for it. |

The conviction moment is the listener's own life, not the founder's. It's the answer to *"why would they believe this works for them?"* and it shapes the close of the narrative.

After Q5, you may ask **one** short open-ended follow-up in plain chat if a beat still feels thin — for example: *"What's the one moment from the last year you'd reach for to make this real for them?"* — but only one. Don't pile on questions; the deck has already done most of the work.

---

## Phase 3 — Tell

For each chosen audience, write a narrative version to a new file in the working directory:

- Coworker → `pitch-narrative-coworker.md`
- Family → `pitch-narrative-family.md`
- Friend → `pitch-narrative-friend.md`

Each file is a single piece of running prose, **roughly 250–500 words**, structured as the founder would actually speak it. Constraints:

- Paragraphs, not slides. No `##` slide headers. No bullet lists.
- No jargon the chosen audience wouldn't use themselves (no *traction*, *runway*, *TAM*, *unit economics* for family; coworker-version may use lighter craft-specific terms if natural).
- Anchor the tone to the **Q2 vocabulary** answer.
- Anchor the opening to the **Q3 opening beat**.
- Skip context the user told you in **Q4** the audience already has.
- Anchor the **close** to the **Q5 conviction moment** whenever the listener could plausibly use the platform themselves. The narrative should end on the shift in *their* life, not on the founder's ask. If the listener can't be a user (pure investor, no maker side), fall back to the deck's line in the sand.
- Numbers and facts come **only** from `pitch-deck.md`. Never invent figures, customers, sources, or quotes. If the deck has `[NEEDS NUMBER: …]` placeholders, leave them out of the narrative entirely — don't substitute a guess.

### Tone targets per audience

- **Coworker** — peer-to-peer, slightly professional, can name the mechanic directly, lands on what's different about the system.
- **Family** — warmer, more "you-know-me", drops most numbers, lands on what funded means for the founder's life.
- **Friend** — most vulnerable; says the part the deck almost says (*"this was the only way I could find to make my own life work"*) out loud.

### After writing

Read each file back to the user as a 2–3 sentence summary, then ask in plain chat: *"Does this sound like you, or do we tighten it?"* If they want edits, edit the file in place — don't rewrite from scratch unless they ask.

---

## Tone rules for the whole skill

- The deck is the formal disclosure. The narrative is the human version of the same truth — **never** a different truth.
- Contractions are fine. Sentence fragments are fine. Slogans aren't.
- If the chosen audience is family and the deck has a number they wouldn't volunteer to family, leave it out. You're not lying — you're choosing.
- Never paste deck slide titles ("Slide 5 — The mechanic") into the narrative. The reader is being told a story, not handed a deck.
- If the user pushes you to invent a fact, decline once and offer to leave a `[ASK FOUNDER: …]` placeholder instead.

## Tools to use

- **Read** — load `pitch-deck.md`.
- **AskUserQuestion** — Q1 through Q4. This is the question loader; don't replace it with free-form chat for those four.
- **Write** / **Edit** — produce and refine the narrative file(s).
