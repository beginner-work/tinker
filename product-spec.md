# tinker — Product Spec

> Voice in, postable link out. The post is the relief. The link is the brick toward funding.

*Background: see `pitch-deck.md` for the why and the broader marketplace mechanic. This spec is the first slice — the act of posting an idea — that proves the platform's mechanic on the founder themselves.*

---

## 1. The one user

The first user is the founder. Specifically, the founder on a morning like this:

- Wakes up anxious because there's a funding application deadline.
- Sits down at the desktop wanting to build, then realizes they don't know what the thing looks like yet.
- Dumps everything they have. Comes up empty-handed.
- Reaches outward — posts on LinkedIn hoping for a bite from someone who already believes in them.
- Reaches inward — opens a skill helper to work through the idea methodically.
- When the skill helper produces something real, they go build on top of it.

Today, three different tools hold three different motions: visibility (LinkedIn), building (desktop), thinking (skill helper). The founder is the connective tissue — anxious, on a deadline, holding it all.

## 2. The one moment

The founder finishes a voice dump. tinker hands back a link to a page that shows their trajectory — where they started this morning (anxious, scattered), where they are now (this idea, articulated in their own words), and a forward feeling-point they're moving toward. They look at the page and say *"that's it."*

The relief is twofold and simultaneous:
- Posting the idea does what an emotional-processing app does for them — the act of speaking it and seeing it shaped is itself the calm.
- The same post is a brick on the path to funding. It's visible, it's shareable, and it counts.

Nothing else they currently use does both at once.

## 3. What it does

The founder talks. tinker transcribes, organizes their own words into a product-shaped structure, and renders that structure into a Spotify-Wrapped-style HTML/CSS page. The page has a unique URL the founder can post anywhere. Every word and every image on the page is the founder's. AI is the librarian; AI is never the author.

## 4. The first version

**One screen. One flow. One outcome.**

- **Input:** A voice dump. The founder speaks freely about an idea — there is no form, no fields, no pre-prompt structure beyond a single open invitation.
- **Output:** A unique URL. The page at that URL is a Spotify-Wrapped-shaped trajectory graphic, rendered in HTML/CSS from a fixed template, populated entirely with the founder's own transcribed words plus a small set of structured emotional waypoints (start, now, forward).
- **The one screen it lives on:** A single record-and-talk surface inside the existing tinker shell (`src/renderer/`). It accepts voice, shows transcription as it lands, and on completion produces the link. `[NEEDS INPUT: should the screen show the trajectory page inline before producing the link, or hand back the link directly and let the founder click through?]`
- **What's deliberately not in v1:**
  1. No AI-written words anywhere on the trajectory page. AI rearranges the founder's own transcript; it never invents a sentence, a header, or a caption.
  2. No AI-generated images. The trajectory graphic is HTML and CSS, full stop. Layouts come from a generic template; only the founder's content (words, chosen colors, optional uploaded images) varies.
  3. No auto-posting on the founder's behalf. tinker hands back a link; the founder decides where it goes.
  4. No filler, no hallucinations, no "AI completed your thought for you" features.
  5. No marketplace mechanics in v1 — funding, investor disclosure, and the offerings storefront from the deck are deferred. v1 is just the post.

## 5. First-time experience

`[NEEDS INPUT: confirm the exact first-screen choice — Phase 2 question I didn't get to.]`

Working assumption (overridable):

The founder lands on the welcome page (the existing tinker chrome). One large prompt: *"What's the idea? Talk to me."* A single record button. No sign-up, no form, no choice of mode.

They tap record. The transcript appears live as they speak. When they stop, tinker does its organizing work — visibly, not as a black box — and produces the link. They click through to see the trajectory page, recognize themselves on it, and the page gives them a Copy Link button.

## 6. The shape of the product

A space they live in. Each voice dump produces a posted page; pages accumulate over time on the founder's profile (per the deck's offerings/profile mechanic). The primary surface is the record-and-talk screen — but the second surface, which arrives soon after v1, is the personal feed of past posts. v1 ships only the record-and-talk screen and the trajectory page. The feed is v2.

## 7. The loop

The founder returns whenever they have a new idea to dump and a new trajectory to post — likely daily during a build sprint, weekly otherwise. Two forces bring them back:

- **Unfinished work compounds.** Each post is a brick. The growing wall of posts is itself a reason to come back — the founder is building a public trajectory, not just a single page.
- **The act of posting is the relief.** The same way someone returns to a journaling app after a hard day, the founder returns to tinker to talk through what's next.

`[NEEDS INPUT: do posts on the founder's profile feel like a feed, a stack, or a single living trajectory page that updates? — Phase 2 shape question.]`

## 8. The line — what tinker won't do

These are not absences. They are the product.

- **AI organizes human input only.** No AI-written words, no AI-generated images, no AI-stitched fillers. Stitching, never authoring.
- **The trajectory graphic is HTML and CSS.** A fixed template, like Spotify Wrapped. The founder's content fills it; the template never invents shape to flatter the content.
- **No hallucinations, no synthesized quotes, no inferred feelings.** If the founder didn't say it, it doesn't appear on the page.
- **No auto-posting.** tinker hands back a link; the founder posts.
- **No pitch meetings.** Per the deck — the platform is the meeting. The post is the disclosure.

## 9. The hard part

`[NEEDS INPUT: Phase 2 Q5 / Q6 — where do you expect this to break first, and which failure scares you most?]`

Inferences from the morning routine you described:

- **The empty state is the morning's empty state.** "I dumped everything and still don't have anything" is the bug we have to design against. If a founder finishes their dump and the trajectory page lands empty or generic, the product fails on the very moment it claims to relieve.
- **The transcript-to-spec organizing has to feel honest.** If the structured output reads as AI-flavored summary rather than the founder's own voice rearranged, the line in section 8 is broken in spirit even if it's intact in fact.
- **The trajectory has to land visually on first try.** The "that's it" moment has no second take. If the page is wrong, the founder won't tweak; they'll close the tab.

## 10. Build sequence

This builds inside the existing tinker repo (`src/main/`, `src/renderer/`). It is not a new app.

1. **Voice capture screen.** Add a new welcome-page mode to `src/renderer/`: a single full-bleed record button, a transcript area that fills in as the founder speaks. Use the platform's MediaRecorder API on Electron and `@capacitor/voice-recorder` (or equivalent) on Capacitor. `[NEEDS INPUT: confirm transcription service — Anthropic API if/when audio input lands, OpenAI Whisper, or a local model.]`

2. **Transcript-to-spec organizer.** A single Anthropic SDK call (Claude Sonnet or Haiku, prompt-cached system prompt) that takes the raw transcript and produces a structured JSON payload using only the founder's own words. The system prompt forbids inventing language; the schema has slots for: `start_feeling`, `idea_in_their_words`, `forward_feeling`, `quoted_lines[]`, `chosen_colors`, `optional_image_urls[]`. The model rearranges, never authors.

3. **Trajectory page template.** A generic HTML/CSS Spotify-Wrapped-style template in `src/renderer/templates/trajectory.html` (or equivalent). Fixed layout. Reads the JSON payload from step 2. Renders the founder's quotes into the slots. No AI in this step — pure templating.

4. **Link generation and storage.** Each completed dump produces a unique URL pointing at a stored payload. `[NEEDS INPUT: storage choice — local file, S3, Supabase, Postgres? — and whether v1 is local-only or already public-by-link.]`

5. **Copy Link surface.** On the rendered trajectory page, a Copy Link button. That's the v1 close.

Steps 1–5 are the v1. Steps 6+ — the founder profile feed, the marketplace mechanic, investor disclosure — are out of scope for this spec.

## 11. How you'll know it's working

`[NEEDS INPUT: Phase 2 question I didn't ask — what would you watch for in week one to know to keep going?]`

Plausible signals to consider:

- The founder (you) finish a voice dump, look at the trajectory page, and post the link without editing the page first.
- A friend or peer clicks the link and reads to the bottom — observable from a single visit-duration metric on the page.
- A second person — someone you didn't onboard by hand — uses tinker without messaging you for help.
- A founder who used tinker mentions the *posting* as the calming part, unprompted.

## 12. Open questions

Before the first line of code:

1. What does the first screen look like the moment the founder lands — one prompt, blank canvas, or example trajectory? (Phase 2 Q3.)
2. Does the founder see the trajectory page inline before getting the link, or does the link arrive first and the page lives at the URL? (Section 5.)
3. Which transcription service? (Section 10, step 1.)
4. What exact slots are on the trajectory template? — start feeling, articulated idea, forward feeling, plus what else? Quotes? Color picker? Optional image upload? (Section 10, step 2 + 3.)
5. Where do posts live after they're created — local, public-by-link, on a profile? Is the profile feed v1 or v2? (Sections 6, 7, 10.)
6. What would have to be true in week one for you to keep building? (Section 11.)
