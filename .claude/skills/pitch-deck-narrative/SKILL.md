---
name: pitch-deck-narrative
description: Sharpen the narrative voice of an existing pitch deck markdown file, slide by slide. Walks each section of a `.md` deck and uses the AskUserQuestion tool to surface the founder's natural voice — the way they'd actually tell the story to a friend — then rewrites each slide so it lands with a Venture Capitalist without losing the founder's spirit. Use whenever the user says "sharpen my deck", "improve my pitch deck narrative", "fix the voice on my pitch", "make my deck sound like me", or hands you an existing pitch deck file and asks to make it better.
---

# Pitch Deck Narrative Sharpener

A section-by-section narrative pass over an existing pitch deck markdown file. The job is **voice alignment**: the deck should sound like the founder talking to their best friend over coffee, but structured so a partner at Sequoia would nod along.

Most decks fail one of two ways:
- **Too founder-voice**: rambling, emotional, no numbers, no spine. A VC bounces.
- **Too VC-voice**: corporate, hollow, full of "leverage" and "synergies". A VC also bounces, because they can tell it's not the founder talking.

This skill closes the gap. Per slide, you elicit the founder's natural way of saying it, then translate into a tight VC-readable line that **still sounds like them**.

---

## How to run the harness

### Step 1 — Locate and read the deck

Ask the user for the path to their pitch deck markdown file if they haven't given one. Read the entire file before doing anything else. Identify each section (typically `##` headings).

If the file looks like the standard 13-slide template from the `pitch-deck` skill, great. If it's a different shape, adapt — work with whatever sections exist, in the order they appear.

### Step 2 — Walk each section, one at a time

For each section, do this loop:

1. **Quote the current text** back to the user verbatim, in 1–3 lines. Don't paraphrase yet.
2. **Diagnose** in one short sentence what's missing or off — too vague, too jargony, no number, no human, no stakes, hedged, etc. Be honest but kind.
3. **Use the AskUserQuestion tool** to surface the founder's natural voice. See "Question patterns" below for which questions fit which slide. Always offer 2–4 concrete options drawn from how a real person would actually answer — not generic prompts.
4. **Reflect** the answer back in plain language: *"OK, so the way you'd actually say it is `X`."*
5. **Rewrite the slide** in the file using Edit. The rewritten slide should:
   - Use the founder's words and rhythm (the way they'd say it to a friend).
   - Carry one concrete number, name, or specific.
   - Be tight — investors read across the room, not on the page.
   - Drop hedges (*"we hope to"*, *"we're trying to"*, *"potentially"*).
6. **Confirm** the rewrite lands with one short question: *"Does that sound like you?"* — and if not, iterate once more before moving on.

Do **not** batch the sections. Do **not** rewrite the whole deck silently and present it at the end. The whole point is the founder hears their own voice get sharper as you go.

### Step 3 — Final pass

After every slide has been touched:
- Read the deck top to bottom and check **continuity of voice** — do all slides sound like the same person?
- Check the **opening hook** (slide 1 / problem) and the **closing line** (last slide) rhyme — investors remember first and last.
- Flag any `[VERIFY]` numbers the founder still needs to confirm.
- Tell the user in 2–3 lines what changed and what's still soft.

---

## Question patterns by slide type

When you call AskUserQuestion, the **options** matter more than the question. Generic options ("more emotional" / "more data-driven") teach the founder nothing. Instead, mock up 2–4 versions of the actual line, in different voices, and let them pick the one that feels like them. They'll usually pick one and tweak it — that tweak is the gold.

Use 1–3 questions per slide, max. If a slide is already strong, skip it and say so.

### Problem slide — find the wrongness in human terms
Question: *"Which of these sounds most like how you'd describe the problem to a friend who asked what you do?"*
Options should be 3 rewrites of the problem statement: one angry, one sad, one matter-of-fact. The founder's pick reveals the emotional register of the whole deck.

### Solution slide — find the relief moment
Question: *"What's the one moment a user feels the thing working? Pick the version that's closest."*
Options should be 3 concrete micro-moments (e.g. *"the first time they open the app and the inbox is already triaged"* vs *"the morning they realize they didn't think about it once"*).

### Why-now slide — find the shift
Question: *"What changed in the world that makes this the right moment?"*
Options: tech shift, behavior shift, regulatory shift, a thing that recently broke. Pick whichever 3 fit; the founder's choice locks the slide.

### Customer slide — find the specific person
Question: *"Which of these is closer to the real person you're building for?"*
Options should be 3 named, fleshed-out personas with age, situation, and the moment they'd hit "buy". Avoid demographics-only ("women 25–40").

### Product slide — find the verb
Question: *"How would you describe what the product actually does, in one verb?"*
Options: 3–4 verbs that change the slide (*"organizes"* vs *"removes"* vs *"replaces"* vs *"defends"*). Verbs are positioning.

### Business model slide — find the unit
Question: *"What's the one number you'd want an investor to remember about how this makes money?"*
Options: ARPU, gross margin, payback period, contract size. Pick what's actually known. If nothing's known, say so plainly on the slide and skip the question.

### Market size slide — find the bottoms-up
Question: *"Which way of sizing the market sounds most defensible — i.e., least like you made it up?"*
Options: bottoms-up (`N people × $P`), comparable (`X% of $Y market`), analog (`like company Z, which hit $A`). Pick the most honest framing.

### Why-us slide — find the conviction line
Question: *"What's the one thing you'd do that a competitor with less skin in the game wouldn't?"*
Options: pulled directly from the founder's earlier conviction answer if you have one, otherwise 3 concrete sacrifices/commitments.

### Competition slide — find the axis
Question: *"What two qualities, when you put them on a 2x2, leave your spot in the empty quadrant?"*
Options: 3 different axis pairs (e.g. *"calm vs. loud × private vs. ad-funded"*, *"fast vs. thorough × expert vs. novice"*). The right pair makes the deck.

### Traction slide — find the truth
Question: *"What's already real? Pick the version that's accurate, not flattering."*
Options: 3 honesty levels — *"pre-launch with `[X]` real artifact"*, *"`[N]` paying customers / `$Y` revenue"*, *"`[N]` waitlist / LOI / pilot signed"*. Refuse to inflate.

### Team slide — find the founder-market fit beat
Question: *"What's the one line about you that makes it obvious you're the right person for this?"*
Options: 3 angles — domain expertise, lived experience of the problem, prior founder track record. One per founder.

### The ask — find the milestone
Question: *"What does success look like at the end of this round? Pick the milestone that's specific enough to bet on."*
Options: 3 milestone framings — revenue ($X ARR), user/usage (`N` weekly actives), product (a specific shipped capability), enterprise (`N` signed contracts).

### Closing slide — find the line they'll quote back
Question: *"Which line do you want investors to repeat to their partners after the meeting?"*
Options: 3 candidate one-liners drawn from the founder's earlier answers — usually a compressed version of their "what I'd give up" or "what I stand for" line.

---

## Voice rules per slide

These apply to every rewrite:

- **Use the founder's actual nouns and verbs.** If they say *"messy"* don't change it to *"unstructured"*. If they say *"normal people"* don't change it to *"consumers"*.
- **Cut hedges.** *"We're trying to"* → *"We"*. *"Hopefully"* → delete.
- **One number per slide.** A real one, even if small. Mark guesses `[VERIFY]`.
- **One idea per slide.** If the slide has two ideas, the second one belongs on a different slide or in the appendix.
- **No business jargon facing the user.** *Synergy*, *leverage* (verb), *disrupt*, *go-to-market*, *value proposition* — banned in conversation. Allowed in the deck only if they actually fit and the founder uses them naturally.
- **Read it aloud test.** If the founder couldn't say the line out loud without cringing, it's wrong. Rewrite.

---

## When you're done

Tell the user, in 3–4 lines:
1. Which slides got a real rewrite vs. a light edit vs. left alone.
2. Any `[VERIFY]` numbers they still need to check before sending.
3. The one slide you think is still the weakest, and why — they decide whether to do another pass.

Then ask: *"Want to do another pass on `[that slide]`, or is this the version you send?"*
