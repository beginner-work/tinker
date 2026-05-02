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

This is where the question loader does the work. Use the **AskUserQuestion** tool for the structured questions below. Send them in batches that make sense conversationally — never dump them all at once, but you may pair Q1+Q2 in a single call if it flows.

**Voice rule for every user-facing question.** Ask like a friend who's curious about the user's life, not a form collecting requirements. Frame each question around the people in the user's life and how the user already lives — never around "the draft", "the audience", "the version we're producing." The user knows nothing about business or pitching. No words like *founder*, *pitch*, *deck*, *mechanic*, *seed*, *traction*, *runway*, *platform-as-jargon*, or *audience-as-marketing-term*. The internal labels in headings (*Q3 — Opening beat*) are model-only — they don't appear to the user.

After each batch, briefly reflect what you heard, in the same warm voice ("Got it — your work has a coworker and a sibling already in its corner; when they ask, you usually keep it short and start with the small real thing that already happened."). Let them correct before you start drafting.

### Q1 — Audience (multiSelect)

> Who generally appreciates your work? You can pick more than one.

| Option | Description |
|---|---|
| Someone you work with | A peer at your job or in your line of work who already gets what you do. |
| A family member | A parent, sibling, or relative who's in your corner. |
| A close friend | Someone who's known you for years and roots for you. |

For each one they pick, run Phase 3 once and produce a separate version.

### Q2 — Vocabulary

> When that person asks how your work is going, how do you usually sound?

| Option | Description |
|---|---|
| Plain and short | Short sentences. No big words. *"I'm building a thing where people can show their work."* |
| Through a story | You start with a moment. *"You know how my barber handed me a hundred bucks? It started there."* |
| Honest about how it feels | You name the feeling first. *"I got tired of pretending in those meetings."* |
| Excited and fast | Lots of energy, lots of detail at once. *"OK so here's the thing..."* |

### Q3 — Opening beat

> When that person says "so what are you up to these days?", what's the first thing that comes out of you?

| Option | Description |
|---|---|
| What's wrong out there | You start with what's broken. *"People with real ideas can't get money unless they pretend to be someone they're not."* |
| Your own life | You start with you. *"I sell hop tinctures and coach careers, and I built a thing for people like me."* |
| How it works | You jump straight to the way the thing is different. *"It's like a marketplace, except there's no meeting."* |
| The small real thing already happening | You start with proof. *"My barber gave me a hundred dollars. That actually happened."* |

### Q4 — Shared ground (multiSelect)

> What does that person already get about you and your work?

| Option | Description |
|---|---|
| What you do most days | They've heard you talk about your work — what you make, who you help. |
| Why you stopped doing what you used to do | They know the personal reason you're on this road now. |
| Roughly what you make or sell | They know the money side, at least loosely. |
| Almost nothing yet | You'd be starting from scratch with them. |

### Q5 — Conviction moment

> What would have to happen in their life for them to feel like this thing is real?

| Option | Description |
|---|---|
| Their inbox changes | Right now people text them "are you free Saturday?" or "can you do this for me?" After they put their work up, those messages turn into "here's $50, no strings, because I believe in what you're doing." |
| Someone they already know puts money in | A friend or family member of theirs backs them within days of them posting. |
| They watch you make real money openly | They see you earning real dollars from real people, on the terms you posted, out in the open. |
| A stranger pays for something they made | They put a small thing up and someone they've never met buys it. |

The answer is about *their* life, not yours. It's why they would believe this works for them — and it shapes the closing line of the version you write.

### Q6 — Why that shift happens

> Why would that shift actually happen? What's the thing about putting work on this page that makes it possible?

| Option | Description |
|---|---|
| Money-backing sorts real support from noise | You finally see who really supports you, because real support shows up as money — any amount. The people who only ever passive-aggressively comment stop mattering once you can see them next to actual receipts. |
| The page makes the value of your time visible | Prices, terms, what you're open to. Casual requests either come with money attached or stop coming. |
| Support stops extracting your time | The page lets people fund or buy instead of book, so the way to back you doesn't cost you hours. |
| Your offerings define a structural "no" | Everything not on the page is a no — and the no is structural, not personal. There's nowhere for passive aggression to land. |

This answer is the mechanism. It's the reason the conviction moment happens. The draft must use this exact reasoning when it explains why the thing works in this person's life — never invent a different mechanism, never lift one from the deck.

After Q6, you may ask **one** short open-ended follow-up in plain chat if a beat still feels thin — for example: *"What's the one moment from the last year you'd reach for to make this real for them?"* — but only one. Don't pile on questions.

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
- Anchor the **why-it-works paragraph** to the **Q6 mechanism**. When the draft explains why this thing causes the Q5 shift, use the user's exact reasoning from Q6. Do not invent a mechanism. Do not lift one from the deck. If you're tempted to write *"because the page makes them look first"* or *"because it cuts out the middleman"* and that wasn't the user's Q6 answer, stop — you're inventing.
- Numbers and facts come **only** from `pitch-deck.md`. Never invent figures, customers, sources, or quotes. If the deck has `[NEEDS NUMBER: …]` placeholders, leave them out of the narrative entirely — don't substitute a guess.
- **Don't lift emotional phrasing from the deck.** Lines like *"this was the only way I could find to make my own life work"* or *"founders aren't underfunded, they're un-met"* land in the deck because the deck builds the context around them. A coworker, family member, or friend doesn't have that context. Any vulnerable beat in the narrative must be grounded in something the listener already recognizes from their own life or from their history with the user — not phrased like the deck.
- **Don't include funding-proof beats unless the listener cares.** The barber / $295 / who-funded-me-first material is for investors. A coworker, family member, or friend isn't deciding whether to fund you; including the proof reads as overselling. Only include it if the listener explicitly evaluates this kind of thing (e.g. they're a potential investor, named in Q1's "Other" or in follow-up).

### Tone targets per audience

- **Coworker** — peer-to-peer, slightly professional, can name how it works directly, lands on what's different about the system.
- **Family** — warmer, more "you-know-me", drops most numbers, lands on what being funded would mean for everyday life.
- **Friend** — most personal. The vulnerable beat is grounded in shared history with this specific friend, not in a deck phrase. The close lands on the Q5 shift, with the Q6 mechanism doing the work of explaining why.

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
