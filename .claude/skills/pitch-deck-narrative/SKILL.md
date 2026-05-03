---
name: pitch-deck-narrative
description: Translate an existing pitch-deck.md into the founder's own voice — by re-asking the deck's own load-bearing claims back at the founder so the voice underneath comes through. Reads pitch-deck.md, extracts the load-bearing claims, asks edge-surfacing questions (one per claim) via AskUserQuestion, and writes a narrative version where the founder's voice is the moat. Use whenever the user wants to "tell my pitch like a human", "make this sound like me", "explain my pitch to my mom / coworker / friend", "narrate the deck", or asks for a non-deck version of their pitch.
---

# Pitch Deck Narrative Harness

A companion to the `pitch-deck` skill. The deck is the formal disclosure for investors. The narrative is the same content **in the founder's actual voice** — which is the moat the deck can't carry on its own.

This skill does **not** ask generic audience or vocabulary questions. It re-asks the deck's own load-bearing claims back at the founder, framed so the answers surface voice and edge — what only this founder, in this body, with this history, can say. Earlier versions of this skill ran a generic Q1–Q6 loader (audience / vocabulary / opening beat / shared ground / conviction moment / mechanism); that version surfaced register, not voice. Voice comes from the deck's own claims being re-asked back at the founder.

## When to run

Run this skill when:
- `pitch-deck.md` exists in the working directory, **and**
- The user wants a narrative, conversational, or "in my own voice" version of the pitch.

If `pitch-deck.md` is missing, stop and tell the user to run the `pitch-deck` skill first. Do not invent a deck to narrate from.

## How it works

Three phases: **Read**, **Probe**, **Tell**.

---

## Phase 1 — Read

Read `pitch-deck.md` in full. Extract **at most six load-bearing claims** — the lines that, if removed, would collapse the pitch. For each, copy the exact wording from the deck. You will quote each claim back to the founder verbatim in Phase 2.

The beats to look for (skip any the deck doesn't carry):

- **The wound** — what's wrong in the world.
- **The thesis** — the one line they'd die on.
- **The mechanism** — why the thing actually causes the change.
- **The unfair advantage** — what they'll do that competitors won't.
- **The proof** — what's already real, however small.
- **The line in the sand** — what they won't do, even for the deal.

Hold the spine in your head — don't summarize it back to the user (they wrote it).

---

## Phase 2 — Probe (re-ask the deck back)

For each load-bearing claim from Phase 1, ask **one** edge-surfacing question via the **AskUserQuestion** tool. The question must:

1. **Quote the deck claim verbatim** in the prompt body.
2. Ask for the version of that claim that only the founder can produce — the line a marketing intern with the same brief couldn't write.
3. Include 3–4 short multi-select options that point at concrete stances, plus an "Other — say it your way" option. Voice surfaces in the "Other" answer about half the time; that's the point.

Question types — pick the one that fits each beat (don't run all five for every claim):

- **Origin** — *"The deck says: '<claim>'. Where in your own life did this start? One specific moment."*
- **Edge** — *"The deck says: '<claim>'. What would you say about this that a competitor with less skin in the game couldn't? Pick the line that would scare them."*
- **Line** — *"The deck says: '<claim>'. What's the version of this you would NOT say, even if it closed the round?"*
- **Voice** — *"The deck says: '<claim>'. If your barber asked mid-fade — how would this come out of your mouth?"*
- **Cost** — *"The deck says: '<claim>'. What did believing this already cost you? Money, relationships, comfort."*

Don't paste these prompts as-is — they're scaffolding. Replace `<claim>` with the actual quoted line from the deck and shape the question around what *that specific claim* is asking. The whole point of this skill is that the questions are derived from this pitch, not a fixed template.

**Voice rule for every prompt.** Talk like a friend who already read the deck and is now sitting across from the founder at lunch. Use no business jargon (*founder, pitch, deck, traction, runway, mechanic, audience*-as-marketing-term). The internal labels (*Origin / Edge / Line / Voice / Cost*) are model-only — they don't appear to the user.

After each AskUserQuestion call, briefly reflect what you heard in the user's exact words — *"got it, the line you're holding is X"* — before moving to the next beat. If a beat feels thin, you may ask **one** open-ended chat-mode follow-up. Just one. Don't pile on questions.

---

## Phase 3 — Tell

Write the narrative to `pitch-narrative.md` in the working directory. Single file. (Audience-tuned variants — coworker / family / friend — are a follow-up branch the user can request after this; the founder-voice version comes first.)

Constraints:

- **Roughly 250–500 words of running prose.** Paragraphs, not slides. No `##` slide headers. No bullet lists.
- **Each Phase 1 claim lands once, in the founder's Phase 2 wording — not the deck's.** If the founder's voiced version is sharper than the deck's, the narrative uses the voiced version.
- **Open on the answer that felt most lived-in.** Often the Origin answer to the thesis claim. Whatever made the founder lean forward.
- **Close on the Line answer.** What they won't do. The narrative ends on the cost they're holding, not on the ask.
- **Numbers and facts come only from `pitch-deck.md`.** Never invent figures, customers, sources, or quotes. If the deck has `[NEEDS NUMBER: …]` placeholders, leave them out of the narrative entirely.
- **Don't lift emotional phrasing from the deck.** A line that lands in the deck because the deck builds context for it doesn't translate cold — phrase it in the founder's Phase 2 voice instead.

After writing, read it back to the user as a 2–3 sentence summary and ask: *"Does the voice land?"* If they want edits, edit in place — don't rewrite from scratch unless they ask.

### Audience variants (optional follow-up)

If the user asks for coworker / family / friend versions after the founder-voice narrative is in place, branch from `pitch-narrative.md` — re-tone, don't re-source. The founder's edge from Phase 2 is the spine across all variants. Write to:

- Coworker → `pitch-narrative-coworker.md` — peer-to-peer, slightly professional, can name how the system works.
- Family → `pitch-narrative-family.md` — warmer, drops most numbers, lands on what being funded would mean for everyday life.
- Friend → `pitch-narrative-friend.md` — most personal; vulnerable beats grounded in shared history with the friend, not in deck phrasing.

Each variant: same 250–500 word shape, same Phase 1 claims, same Phase 2 voice — just retoned for the listener.

---

## Hard rules

- **The deck is the formal disclosure. The narrative is the human version of the same truth — never a different truth.**
- **Do not invent claims not in the deck.** The deck is the source of truth.
- **Do not fabricate the founder's voice.** If a Phase 2 answer is thin, re-ask once — don't paper over with a generic line.
- **Do not re-ask the old generic Q1–Q6** (audience / vocabulary / opening beat / shared ground / conviction moment / mechanism). Earlier versions of this skill did, and produced register-correct narratives that didn't sound like the founder. Voice comes from re-asking the deck's own claims back.
- **Never paste deck slide titles** ("Slide 5 — How it works") into the narrative. The reader is being told a story, not handed a deck.
- **If the user pushes you to invent a fact**, decline once and offer to leave a `[ASK FOUNDER: …]` placeholder instead.

## Tools to use

- **Read** — load `pitch-deck.md`.
- **AskUserQuestion** — Phase 2 probes, one per load-bearing claim.
- **Write** / **Edit** — produce and refine narrative file(s).
