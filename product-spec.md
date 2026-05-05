# tinker — Product Spec

> A LinkedIn-shaped feed of essays, with a writing surface that feels like onboarding — not a chat. Claude interviews one question at a time, the maker types, the essay is stitched from the maker's own words and posted as a URL. Each draft is a tab in the existing tinker shell.

*Background: see `pitch-deck.md` for the broader marketplace mechanic. This spec is the first slice — the act of writing and posting an essay — that proves the platform on the maker themselves.*

---

## 1. The one user

The first user is the founder. Specifically, the maker on a morning like this:

- Wakes up with an idea pressing against the inside of their head.
- Opens tinker. Sees the sidebar of drafts they've been carrying — some finished, some abandoned, some half-formed.
- Starts a new draft. Claude asks the first question. The maker starts typing.
- A few rounds in, the prose has shape. They publish. The URL is the brick.

Today this motion is split across journaling apps (private), drafts in Notion (no audience), Twitter/LinkedIn (audience but no shape), and a chat with Claude (shape but nothing to post). The maker stitches it together by hand. tinker collapses it into one surface.

## 2. The one moment

The maker has been pushing an idea around for days. They open tinker, hit `+`, get a fresh draft. Claude's first question is already in the margin. They type a paragraph. Claude asks the next question. After four or five rounds, they scroll up and read the stitched prose — every sentence is theirs, just rearranged. They recognize the idea on the page. They hit publish. A URL appears. They paste it into Twitter.

The relief is twofold and simultaneous:
- Writing it down does what a journaling app does — the act of articulating it is the calm.
- The same essay is a brick on a public trajectory. It's visible, shareable, and counts.

Nothing else they currently use does both at once.

## 3. What it does

The maker writes inside an onboarding-shaped flow. Claude reads what they've written and asks the next question — one at a time, full focus, paginated, with a progress indicator. The maker keeps writing. Claude stitches the answers into prose using only the maker's own words — never inventing a sentence, a header, or a phrase. When the maker is satisfied, they publish. The essay lives at a unique URL. Other makers' published essays live in the LinkedIn-shaped feed the writer launched from.

AI is the interviewer; AI is never the author.

## 4. The first version

**One shell. One layout. One outcome.**

The existing tinker browser chrome stays — sidebar on the left, center column for content. The semantics change.

- **Left sidebar:** Tabs are drafts. Each writing session is a tab. `+` starts a new draft. Drafts persist across sessions. Web tabs (opened by typing a URL into the address bar) still coexist in the same sidebar, but the default behavior of `+` is "new draft."
- **Center column (default view):** A LinkedIn-shaped surface. At the top, a compact "Start writing" entry point — sized like LinkedIn's "Start a post" box: small enough to invite the next draft without dominating the page. Below it, a feed of other makers' published essays — cards, scrollable. `[NEEDS INPUT: feed source for v1 — chronological global, follower graph, curated set, invited cohort?]`
- **The writing surface itself opens from that entry point** (or from clicking a draft tab in the sidebar) and feels like an **onboarding flow**, not a chat. One Claude question at a time, full focus, large input area, a progress indicator. The maker advances through questions; the stitched essay assembles behind the flow. At the end: a review screen and a publish button. `[NEEDS INPUT: visual transition — modal over the feed, full-screen takeover of the center column, slide-up panel, or other.]`
- **Removed:** the Haiku search-essay surface. tinker is a writing tool, not a search tool. The address bar still accepts URLs for direct navigation, but typing a query no longer triggers a generated essay. `[NEEDS INPUT: confirm the address bar still navigates to URLs, or whether it gets repurposed entirely for the writer.]`
- **Output:** A unique URL per published essay. The page at that URL renders the essay in tinker's own type system (Plus Jakarta Sans display, Inter body, cream background). `[NEEDS INPUT: URL shape — `tinker.app/handle/slug`, `tinker.app/essay/id`, or other.]`
- **What's deliberately not in v1:**
  1. No AI-written sentences in the published essay. Claude rearranges the maker's own typing; never invents prose.
  2. No comments, likes, or replies on others' essays in the feed. Reading is the only interaction.
  3. No auto-posting to other platforms. tinker hands back a URL; the maker decides where it goes.
  4. No web search as a feature. The Haiku essay-render surface is removed.
  5. No marketplace mechanics — funding, investor disclosure, offerings storefront — deferred to later versions.

## 5. First-time experience

`[NEEDS INPUT: confirm the cold-start choice.]`

Working assumption (overridable):

The maker opens tinker. Sidebar is empty. Center column shows the LinkedIn-shaped surface — a compact "Start writing" entry point at the top, then a feed of two or three seeded essays from others below it (so day one isn't blank).

The maker clicks the entry point. The onboarding flow opens. Claude's first question is on screen, alone, full focus: *"What are you here to figure out?"* A large input. The maker types a paragraph and advances. Next question. Then the next. At the end, a review screen shows the stitched essay — every sentence theirs, just rearranged. A publish button. They click. A URL. They copy it. The flow closes. They land back on the feed with their new essay at the top.

## 6. The shape of the product

A space they live in. The sidebar accumulates drafts; the feed accumulates others' essays. The maker's own published essays go to their profile `[NEEDS INPUT: where the maker sees their own published work — a separate sidebar section, a profile tab, or surfaced in the feed]`.

The default view is LinkedIn-shaped: a feed in the center column, a "Start writing" entry point at the top of it. The writing surface is *not* always-on. It opens when summoned (entry-point click, draft-tab click, keyboard shortcut) and takes focus — onboarding-flow shape, one question at a time. When closed, the maker is back on the feed.

The sidebar holds drafts the way a browser holds tabs. Each tab is one draft. Clicking a tab opens its onboarding flow exactly where the maker left off — the question they were on, the answers they'd given, the stitched prose so far.

## 7. The loop

The maker returns whenever they have a new idea — likely daily during a writing sprint, weekly otherwise. Two forces bring them back:

- **Drafts compound.** The sidebar fills with in-flight ideas. Some get published; some sit. Either way, the wall of tabs is itself a reason to come back — there's something to finish.
- **The act of writing is the relief.** The same way someone returns to a journaling app after a hard day, the maker returns to tinker to articulate what's on their mind.

Reading the feed is a secondary loop — when the maker doesn't have something to write, scrolling the feed exposes them to peers and seeds future drafts.

## 8. The line — what tinker won't do

These are not absences. They are the product.

- **AI interviews; AI never authors.** No AI-written sentences in the published essay. Claude asks questions and rearranges the maker's own words. Stitching, never authoring.
- **Not a chat.** The writing surface has no persistent text area at the bottom, no scrolling message thread. It's an onboarding-shaped guided flow — focused, paginated, one question at a time.
- **No hallucinations, no synthesized quotes, no inferred feelings.** If the maker didn't type it, it doesn't appear in the essay.
- **No auto-posting.** tinker hands back a URL; the maker posts.
- **No web search as a feature.** tinker is a writing tool. The Haiku search-essay surface is removed.
- **No social affordances in v1.** No comments, likes, or replies on others' essays. Reading is the only interaction.
- **No pitch meetings.** Per the deck — the platform is the meeting. The post is the disclosure.

## 9. The hard part

`[NEEDS INPUT: where you expect this to break first, and which failure scares you most.]`

Inferences from the shape:

- **The onboarding shape is the make-or-break.** If the writing surface looks like a chatbot — text area at the bottom, message bubbles climbing up — the maker reads it as conversation and produces conversational text, not an essay. The flow has to feel like the product is shaping their writing with them, the way good onboarding shapes a user's account.
- **The interview has to feel like a real interviewer.** If Claude's questions read as generic or formulaic, the maker stops trusting the surface. The questions must be specifically responsive to what the maker just typed.
- **The stitching has to read as the maker's voice.** If the prose comes back AI-flavored — smoothed, summarized, paraphrased — the line in section 8 is broken in spirit even if it's intact in fact.
- **The feed is a knife edge.** Done right, it inspires; done wrong, it intimidates the maker out of starting. The first three essays a new maker sees set the tone.
- **Drafts as tabs has a tab-sprawl problem.** Browsers already let users accumulate forty open tabs they never close. Drafts will do the same. `[NEEDS INPUT: do drafts get archived, decay, or sit forever?]`

## 10. Build sequence

This builds inside the existing tinker repo (`src/main/`, `src/renderer/`). It is not a new app. The browser shell stays; the welcome page is rewritten.

1. **Remove the Haiku search-essay surface.** Strip the existing welcome-page query → essay flow from `src/renderer/`. Address bar still navigates URLs but no longer triggers generated essays.

2. **LinkedIn-shaped welcome page.** Replace the search surface with a feed-shaped center column: a compact "Start writing" entry point at the top, a feed of others' published essays below. Card-shaped entries; scroll the column. `[NEEDS INPUT: feed source and ordering for v1.]`

3. **Drafts as tabs.** Repurpose the existing tab/session model in the sidebar so `+` opens a new draft tab by default. Each draft tab points at one in-progress essay. Persist drafts across sessions. `[NEEDS INPUT: local-only in v1, or already cloud-synced?]`

4. **Onboarding-shaped writing flow.** Clicking the entry point (or a draft tab) opens the writing flow. One Claude question at a time, full focus, large input, a progress indicator, a review screen at the end. The flow is paginated and stateful — leaving and reopening lands the maker exactly where they were. **It is explicitly not a chat:** no persistent text area, no message-thread scroll. `[NEEDS INPUT: visual transition — modal over the feed, full-screen takeover, slide-up panel — see section 4.]`

5. **The interview + stitching engine.** A single Anthropic SDK call (Claude Sonnet, prompt-cached system prompt) per turn. Inputs: the running transcript of the maker's typing plus prior questions. Outputs: (a) the next question, (b) the updated stitched prose, drawn only from the maker's own words. The system prompt forbids inventing language.

6. **Publish action.** A publish button on the review screen generates a unique URL and persists the essay payload. The published page renders the essay in tinker's existing type system. The flow closes; the maker lands back on the feed with their new essay at the top. `[NEEDS INPUT: storage — local file, S3, Supabase, Postgres? — and whether v1 is local-only or already public-by-link.]`

Steps 1–6 are v1. The marketplace mechanic, investor disclosure, and the offerings storefront from the deck are out of scope.

## 11. How you'll know it's working

`[NEEDS INPUT: what you'd watch for in week one to know to keep going.]`

Plausible signals to consider:

- The founder (you) finish a draft, publish it, and post the URL externally without editing the essay first.
- A friend or peer clicks the URL and reads to the bottom — observable from a single visit-duration metric.
- A second person — someone you didn't onboard by hand — opens tinker, starts a draft, and publishes one.
- A maker who used tinker mentions the *writing* as the calming part, unprompted.
- The sidebar of drafts grows over a week — meaning the loop is sticky, not single-shot.

## 12. Open questions

Before the first line of code:

1. Onboarding flow detail — one question per screen or grouped, advance manually or auto, progress indicator shape (steps, bar, percentage)? (Sections 4, 5, 10.)
2. Visual transition for the writing flow — modal over the feed, full-screen takeover of the center column, slide-up panel, or other? (Sections 4, 6, 10.)
3. Feed source for v1 — chronological global, follower graph, curated set, invited cohort? (Sections 4, 6, 10.)
4. Address bar — still navigates URLs, or repurposed entirely? (Section 4.)
5. URL shape for published essays — `/handle/slug`, `/essay/id`, or other? (Section 4.)
6. Where the maker sees their own published essays — separate sidebar section, profile tab, or surfaced in the feed? (Section 6.)
7. Draft lifecycle — archive, decay, or sit forever? (Section 9.)
8. Storage — local-only in v1, or already cloud-synced and public-by-link? (Section 10.)
9. What would have to be true in week one for you to keep building? (Section 11.)
