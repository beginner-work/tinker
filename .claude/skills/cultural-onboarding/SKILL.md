---
name: cultural-onboarding
description: Use when someone is trying to join, learn about, or feel welcomed into a new cultural, ethnic, diaspora, or heritage group — especially when they do not know their own origins (adopted, displaced, mixed-heritage, estranged from family, or simply unsure). Uses the AskUserQuestion tool to ask gentle, open-ended questions about what is drawing them in, how they relate to not-knowing, and what pace feels right, then suggests concrete first steps for connection.
---

# Cultural Onboarding

Help someone find their way into a group they want to belong to, when they do not know where they come from. The goal is not to gatekeep or assign identity. The goal is to listen, name what is already true for them, and offer doors they can walk through at their own pace.

## When to use

Trigger this skill when the user says things like:

- "I'm trying to connect with [a group] but I don't know where I'm from."
- "I was adopted and I want to learn about my birth culture."
- "My family stopped speaking the language two generations ago."
- "I feel pulled toward [a community] but I'd feel like a fraud showing up."
- "How do I get into [diaspora / heritage / faith / regional] community?"

If the request is purely informational ("tell me about X culture"), this skill is not the right fit — answer normally. This skill is for the onboarding-into-belonging conversation specifically.

## Tone

- **Listen before suggesting.** The questions are the work, not a preamble to advice.
- **Never gatekeep.** Belonging is not a quiz. There is no minimum heritage percentage, no test of authenticity.
- **Treat not-knowing as its own real experience**, not a deficit to be fixed. Some users are grieving, some are curious, some are matter-of-fact. Don't assume which.
- **Let them name themselves.** Never tell a user what they are ("you sound X to me"). Reflect back what they said, not what you inferred.
- **Don't push DNA tests.** They're loaded — financially, emotionally, politically. Mention only if the user brings them up first.

## Workflow

Always use the `AskUserQuestion` tool — never freeform questions in chat — so the user gets the picker UI and an "Other" escape hatch. Ask in small rounds (1–3 questions at a time), not one giant batch. Wait for answers before moving on. After each round, briefly reflect what you heard before the next round, so the user feels heard rather than processed.

### Round 1 — What is pulling them in

Open with one or two questions about the present moment. Don't dig into history yet.

Example questions to pass to `AskUserQuestion`:

- **question:** "What's drawing you toward this group right now?"
  **header:** "Pull"
  **options:**
  - A specific person or relationship
  - A piece of art, food, music, or place
  - A feeling that this might be where I'm from
  - Something I can't quite name yet
- **question:** "How familiar are you with this group already?"
  **header:** "Familiarity"
  **options:**
  - A lot — I've been reading or watching for a while
  - Some — surface familiarity
  - Almost nothing — I'm starting fresh

### Round 2 — Their relationship to not-knowing

Only after Round 1, and only if it feels welcome. These are tender. Phrase them softly.

- **question:** "When you think about not knowing where you come from, what feels most true?"
  **header:** "Not knowing"
  **options:**
  - Curious — I want to learn
  - Grieving — there's loss in it
  - Neutral — it's just a fact of my life
  - Complicated — all of the above
- **question:** "Do you have any starting threads at all — a name, a region, a relative, a phrase, a recipe?"
  **header:** "Threads"
  **options:**
  - Yes, a few
  - One small thing
  - Nothing concrete yet

### Round 3 — How they want to connect

Now you can offer pathways. Use `multiSelect: true` here — these aren't mutually exclusive.

- **question:** "Which of these feel like good first doors? Pick any that resonate."
  **header:** "Doors"
  **multiSelect:** true
  **options:**
  - Food and cooking
  - Language, words, or names
  - History and reading
  - Music, film, or visual art
  - Meeting people in person
  - Online community first
  - Religious or spiritual practice
- **question:** "What pace feels right?"
  **header:** "Pace"
  **options:**
  - Slow — one small thing at a time
  - Steady — a regular weekly-ish practice
  - Immersive — I want to dive in

## After the questions

Synthesize their answers into **two or three** concrete, low-stakes first steps that match their pace and chosen doors. Not a list of twenty. A few good ones, named specifically.

A good response includes:

1. One small thing they can do alone this week (a recipe, a song, a short reading).
2. One thing that involves another human, with a note that they do not have to prove anything to be welcome.
3. A reminder that curiosity is enough — they don't need permission or paperwork to begin.

If they have starting threads (a name, a region), gently suggest where those threads can be tugged — local archives, diaspora organizations, oral-history projects — without promising answers.

## What not to do

- Don't ask all the questions at once. The pacing matters as much as the content.
- Don't suggest DNA tests unprompted.
- Don't claim identity on the user's behalf.
- Don't give a long resource dump — pick a few specific things.
- Don't treat the conversation as solved after one round of suggestions. Offer to keep going.
