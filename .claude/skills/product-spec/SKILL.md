---
name: product-spec
description: Build a buildable product spec through a guided interview, for users who have never shipped a product from 0 to 1. Translates a vague vision ("I want to make a thing for people like me") into one specific user, one moment of relief, one tiny first version that ships, and the line of features they'll deliberately not build. Uses the structured question tool (AskUserQuestion) for the narrowing phase, and produces a versioned `build-prompt.md` as the canonical imperative output. Use whenever the user wants to "spec my product", "figure out what to build first", "turn my idea into something I can actually start", "write a product spec", or describes a product idea in human terms and asks for help shaping it.
---

# Product Spec Harness

A content harness for turning a 0-to-1 builder's idea into a buildable build prompt through conversation. The user has likely never shipped a product before. They speak in dreams, vibes, and "wouldn't it be cool if". You translate that into the smallest concrete thing they can build next, written down clearly enough that they could hand it to a co-founder, a contractor, or themselves three weeks from now and not lose the plot.

The canonical output of this skill is `build-prompt.md` — an imperative directive a build agent (or future you) executes. The descriptive product spec is internal scaffolding only; this repo's skills work off imperative programming, not descriptive docs. Skip the spec write by default.

## How to run the harness

This is an interview, not a form. Ask questions one or two at a time, in plain language. Reflect each answer back in your own words before moving on — the user should feel heard, and you should confirm you understood. **Never** dump all the questions at once. **Never** lecture about product concepts (MVP, retention, funnel, scope creep); translate silently.

Run three phases in order: **Foundation**, **Narrowing**, **Synthesis**. Don't move to the next phase until the current one is done.

**Always use the AskUserQuestion tool — the question loader — for every question you ask the user, across all three phases.** This is non-negotiable. Phase 1's open-ended questions, Phase 2's structured prompts, and every always-ask follow-up all go through the loader. The user can always pick "Other" to give a free-text answer, so open-endedness is preserved without dropping back into plain-chat questions. Reflections back to the user (e.g. *"OK, so what I'm hearing…"*) are confirmations, not questions — those stay in conversation, not in the loader.

### One product per session

If the user has more than one idea in flight (e.g. a browser app and a marketplace platform), ask up front via **AskUserQuestion**: *"Which one are we speccing today?"* with one option per idea the user mentioned, plus a closing line in chat: *"We can do the others in a separate pass."* Don't try to spec two products in one run. The output is one `build-prompt.md` per product.

### If a pitch deck exists

If `pitch-deck.md` exists in the working directory, read it first as background. The deck is *who and why*; the build prompt is *what actually ships*. Don't repeat the deck's content in the build prompt — refer to it. And don't let the deck constrain the build prompt: if the user wants to ship one slice of a bigger platform, that's the right move.

### If an existing app shell exists

If the working directory contains `README.md` and `src/` (or similar), the product likely lives **inside an existing shell**, not greenfield. Read the README first; skim `src/` to identify the structural primitives the new screen will inherit (tabs, sidebar, welcome page, address bar, modal stack, navigation rail — whatever the existing app provides). Note their file paths. The build prompt's "Read first" and "Constraints" sections will enumerate them by name. **Do this before Phase 1, not after** — the single most common skill failure is producing a build prompt for a greenfield product when the user is actually building inside an existing app, and the resulting build drifts away from the existing shell into a "separate app bolted alongside" shape.

If the user is genuinely greenfield, confirm in the first reflection: *"This is a brand-new app, not something living inside another app you already have — yes?"*

---

## Phase 1 — Foundation

Phase 1 is two parts: a one-question **prelude** about platform target, then the five broad foundation questions. Ask the prelude first — it shapes everything downstream. Every question in Phase 1 goes through **AskUserQuestion**; the loader's "Other" option preserves open-endedness.

### Prelude — platform target

Ask via **AskUserQuestion** before the five foundation questions. Use this exact question and these options (the user can always pick "Other" to give a free-text answer):

> Before we dig into the product itself: where does this run first?

| Option | Description |
|---|---|
| Web / PWA in a browser | A website people open in a browser; works on any device. The safe default if you're not sure. |
| Desktop app I install | A native app for Mac / Windows / Linux. |
| Phone app | A native app for iPhone or Android. |
| All of the above from one codebase | One codebase, web first, then native shells after. |

Capture the answer. This shapes the build prompt's phase plan. If the user picks *All of the above from one codebase*, the build prompt will phase the work — web/PWA first, native shells after explicit approval. If single-target, no phasing.

### The five broad questions

Ask each via **AskUserQuestion**, one at a time, in order. After each, reflect the answer back in plain chat and capture it. Use everyday language; the parenthetical maps to spec terms — keep that to yourself. The loader's "Other" option is the escape hatch when the user's real answer doesn't fit any choice — encourage them to use it freely.

1. **Hero moment.** Question: *"Picture one specific person using your thing for the first time. What's the one moment where they go 'oh — this is for me'?"*
   Options (4): *"They see a result that solves their problem in one shot"*, *"They feel understood — the product knows them"*, *"They finish something they'd been putting off"*, *"They share it with someone immediately"*.
   *(Maps to: hero use case, core value moment, the single feature that earns the product.)*

2. **Status quo.** Question: *"What did that same person do yesterday — before your thing existed — to handle this?"*
   Options (4): *"Nothing — they lived with the problem"*, *"A manual workaround (spreadsheet, notes app, paper)"*, *"A different product that's clunky or expensive"*, *"They paid a person to do it for them"*.
   *(Maps to: status quo, what you replace, baseline behavior. Reveals whether the problem is real and how big the wedge is.)*

3. **One tiny thing.** Question: *"If your thing could only do one tiny thing well, and absolutely nothing else, what would that one thing be?"*
   Options (4): *"Take an input and return a finished output"*, *"Show the user something they couldn't see before"*, *"Save them a step they do every day"*, *"Connect them to a person or community"*.
   *(Maps to: MVP scope. The single feature that proves the mechanic works.)*

4. **In and out.** Question: *"What goes in, what comes out? What does the person hand to your thing, and what do they walk away with?"*
   Options (4): *"They give text / answers → get a generated artifact"*, *"They upload a file → get it transformed"*, *"They configure something → get a saved workspace"*, *"They ask a question → get an answer or recommendation"*.
   *(Maps to: primary user flow, inputs and outputs.)*

5. **The line.** Question: *"What's the line — what would your thing definitely NOT do, even if a user begged?"*
   Options (4): *"No AI-written content / no generated words on the page"*, *"No social features / no public profiles or feeds"*, *"No ads, tracking, or data resale"*, *"No enterprise / B2B features even if asked"*.
   *(Maps to: scope boundaries, principles, the things saying yes to would break the product.)*

After all five, summarize back in plain chat: *"OK, so what I'm hearing: someone in `[situation X]` opens this thing, the moment they feel it is `[Y]`, the closest thing they do today is `[Z]`, the smallest version of your product is just `[W]`, and you'd never build `[V]`. Yes?"* Get a confirm or correction before moving on.

---

## Phase 2 — Narrowing (use AskUserQuestion)

Keep using the question loader to nail down the specifics. Send these in batches that flow conversationally — never dump them all at once. Pair Q1+Q2 in one call if it flows; same with Q5+Q6.

After each batch, reflect what you heard in plain chat (*"Got it — they open it daily, it's a feed, and the thing that brings them back is a draft they left half-finished."*). Let them correct before you move on. Reflections stay in chat; new questions stay in the loader.

**Voice rule for every user-facing question.** Ask like a builder friend who's curious about the thing they're making, not a form collecting requirements. The user knows nothing about product management. No words like *MVP*, *retention*, *acquisition*, *funnel*, *churn*, *PMF*, *flywheel*, *iterate*. The internal labels in headings (*Q3 — First-time experience*) are model-only — they don't appear to the user.

### Q1 — How often (singleSelect)

> How often do you imagine that person using your thing, once it's a regular part of their life?

| Option | Description |
|---|---|
| Once and done | They use it once, get the thing, leave. (Tax filing. Naming a baby. Writing a will.) |
| Now and then | A few times a year, when the situation comes up. |
| Weekly-ish | A regular part of their week. |
| Daily | They open it every day, sometimes more. |

(Determines whether the build prompt needs a return loop, a notification system, a saved-state model, or none.)

### Q2 — Shape of the thing (singleSelect)

> When that person uses it, what shape does it take?

| Option | Description |
|---|---|
| A page they fill in | Forms, fields, a thing they configure. |
| A feed they read | Posts, items, a list that changes over time. |
| A tool that does the work | They press a button, it produces an output. |
| A space they live in | A workspace they come back to and accumulate things in. |
| A conversation | They talk to it, it talks back. |

(Shapes the primary screen and the data model.)

**Always-ask follow-up to Q2 (via AskUserQuestion).** If the user picked *A conversation* or *A tool that does the work*, ask this next via the loader:

> In what shape does that conversation or tool take place?

| Option | Description |
|---|---|
| Chat (text area at the bottom, thread climbs up) | Like ChatGPT. Persistent input box, message bubbles, scroll history. |
| Onboarding flow (one question at a time, paginated) | Like Typeform or Stripe's setup. Big focus, progress indicator, one prompt per screen. |
| Wizard (named steps with a Next button) | Like a tax-prep app. Discrete labeled steps the user advances through. |
| Something else | Pick this if none of the above match — describe in your own words. |

Capture the answer. The chat-vs-onboarding-flow distinction is the difference between a ChatGPT clone and a guided experience — both are conversational, but the UI shapes are opposites. The build prompt's UI-shape constraint and anti-pattern are derived from the answer.

### Q3 — First-time experience (singleSelect)

> The very first time someone opens your thing — before they've signed up, paid, or done any work — what should they see?

| Option | Description |
|---|---|
| The thing already working with example data | They see the product alive, populated, doing its job. |
| One question, asked of them | A single prompt that invites them in. |
| A blank canvas with one button | Empty, but with a clear "start here" gesture. |
| Someone else's work, beautifully | A gallery, feed, or showcase that earns trust before asking anything. |

### Q4 — What brings them back (multiSelect)

> If they leave and come back tomorrow, why? Pick all that fit — or pick the last one if the honest answer is they wouldn't.

| Option | Description |
|---|---|
| Something changed while they were gone | New content, new replies, new opportunity. |
| They have unfinished work in here | A draft, a project, a thing they started. |
| They get a result on a schedule | They come back because the calendar says to. |
| Someone they care about is here | A person, a community, a relationship lives in the product. |
| You sent them a notification | An email, push, or text pulled them back. |
| They wouldn't, really | One-and-done is the honest answer. |

### Q5 — Hardest moment (singleSelect)

> Where do you think the average person will get stuck or give up?

| Option | Description |
|---|---|
| Before they sign up — they don't get what it is | The pitch is the bottleneck. |
| At the empty state — they don't know what to put in | They sign up but freeze on first use. |
| Halfway through their first task — too much work for too little payoff | The work-to-value ratio is wrong. |
| After their first win — they don't see why to come back | The loop isn't earned. |
| You're not sure | Honest answer. You'll find out by shipping. |

### Q6 — Risk you're most worried about (singleSelect)

> When you imagine launching and it not working, what's the failure that scares you most?

| Option | Description |
|---|---|
| Nobody shows up | The audience doesn't find it or doesn't care. |
| People show up but bounce | They open it, look around, leave. |
| People love it but won't pay | Engagement without revenue. |
| It works but doesn't scale | The first 10 are fine; the next 1,000 break it. |
| You burn out before it lands | The build is bigger than you can carry. |

### Q7 — Visual canon (singleSelect)

> When the page renders for the first time, what should it look like? Where does the visual truth live?

| Option | Description |
|---|---|
| The existing app I already have | Same chrome, same fonts, same colors, same buttons. The new screen is a sibling of what's already there, not a new design. |
| My own design tokens / dictionary | I have brand tokens, a design dictionary, or a style file the agent should consume verbatim. |
| A specific reference | I have a reference product or screenshot whose feel I want to land in (e.g. Spotify Wrapped, Linear, a Figma). |
| Nothing yet — pick before code | I haven't decided. Force me to pick before synthesis; do not let the agent invent. |

(This is the question that prevents the most common 0-to-1 failure: the agent inventing a UI from scratch because the build prompt didn't tell it where to inherit from. If the user picks "Nothing yet," stop and force a decision before Phase 3.)

After Q7, you may ask **one** follow-up via AskUserQuestion if a beat still feels thin — for example: *"What's the one thing you'd be crushed to see go wrong on launch day?"* with 3–4 plausible options + Other — but only one. Don't pile on.

### Always-ask follow-ups (via AskUserQuestion)

Ask these three through the question loader, one per call, after Q7. Each maps to a section of the build prompt; "Other" is always available for free-text answers.

**F1 — Existing pieces.** Question: *"What pieces of this already exist anywhere — a doc, a sketch, a half-built prototype, a piece of someone else's app you keep referencing?"*
Options (4): *"A written doc / notes / a pitch"*, *"A sketch, wireframe, or Figma"*, *"A half-built prototype or code"*, *"Nothing yet — it's all in my head"*.
→ Seeds the build sequence.

**F2 — One screen.** Question: *"If a contractor said 'I can build you exactly one screen this month' — which screen?"*
Options (4): *"The first-time / onboarding screen"*, *"The main thing-they-do screen"*, *"The result / output screen"*, *"The dashboard / home / feed they return to"*.
→ Forces the MVP cut.

**F3 — Success signal.** Question: *"How would you know, in one week, that you should keep building this — or stop?"*
Options (4): *"A specific person uses it without me prompting them"*, *"Someone I don't know finishes the core flow"*, *"Someone pays me / commits money"*, *"I'd just feel it — no concrete signal yet"*.
→ The success signal.

---

## Phase 3 — Synthesis (write the build prompt)

Once Phases 1 and 2 are done, write `build-prompt.md` to the working directory. **This is the only required output of the skill.** Skills in this repo work off imperative programming — the build prompt is the imperative artifact a build agent (or future you) executes against. The descriptive product spec is **internal scaffolding only**: organize the user's answers into the 13-section structure below to think clearly, but do not write `product-spec.md` to disk unless the user explicitly asks (see "Optional: also write product-spec.md" below).

Translate the user's words upward, but **never invent product details**. If they didn't tell you a screen exists, don't add it. If they didn't name a feature, don't list it. If a section needs information you don't have, leave a `[NEEDS INPUT: what to ask the founder]` placeholder. A blank with a clear question is better than a fabricated detail the user later has to refute.

Especially: never invent users, personas, metrics, screens, or competitor names. Don't write *"power users will appreciate the keyboard shortcuts"* if the user never mentioned power users or shortcuts. Don't write *"50% of users will convert"* — there are no users yet. If a number genuinely belongs and you don't have one, leave `[NEEDS INPUT: …]`.

If the user described something the smallest version cannot deliver, **say so** in the build prompt's open-questions section and offer a smaller cut. The goal is the right build prompt, not a flattering one.

### Internal scaffold (do not write to disk)

Before producing the build prompt, organize the user's answers into the 13-section scaffold below. Use it as a thinking aid only — `product-spec.md` is *not* an artifact this skill produces by default. Each section of the build prompt traces back to specific scaffold sections (mapped in "Filling the template" further down).

```markdown
# [Product Name] — Internal Scaffold

> One sentence. The user's "moment of relief" answer compressed.

## 1. The one user
One specific person. Who they are, what their day looks like before this exists, what they're doing the moment they open the product. From Phase 1 Q1 + Q2 — concrete, not a persona.

## 2. The one moment
The single moment of relief. The thing the user feels that nothing else gives them. From Phase 1 Q1.

## 3. What it does
The smallest description of the product. Two or three sentences, plain language. Anyone reading this should be able to picture what it is.

## 4. Visual canon (where the look comes from)
**This section is non-negotiable for the agent.** From AskUserQuestion Q7. Name the source of visual truth — the existing app shell, the user's design tokens, a specific reference — and quote the exact paths or asset names the agent must inherit from. The agent does not invent buttons, fonts, colors, containers, spacing, or animation. If a visual decision isn't already made in the named source, the agent stops and asks the user before inventing.

If the user answered "Nothing yet — pick before code," do **not** continue to the build prompt. Return to Phase 2 and force the decision.

Required content:
- **Source of truth:** explicit path(s) or asset name(s) — e.g. `src/renderer/styles.css`, `src/renderer/tokens/rainbow-web.json`, *"the existing welcome page in `src/renderer/index.html`"*.
- **Inherited visual primitives:** the buttons, typography, color tokens, container shapes the new screen must reuse. List them by name as they appear in the source.
- **Inherited structural primitives:** the sidebar, tab/session model, address bar, navigation rail, modal pattern, welcome page — every UI primitive the new screen lives inside or alongside. Name the file paths (e.g. `src/renderer/renderer.js` for the tab model, `src/renderer/index.html` for the welcome surface). Inheriting visuals without inheriting structure produces builds that "feel like a separate app bolted onto the existing app." If the user is building inside an existing shell and structural inheritance isn't named, the scaffold is incomplete — return to Phase 1 and probe the shell.
- **What the agent may NOT do:** introduce a new font, a color outside the tokens, a custom button visual, a new icon library, an animation library, a CSS framework, OR a new structural primitive (a new sidebar, a new tab model, a new welcome page, a new modal stack) when the host app already has one. List the temptations explicitly so the rule is enforceable, not vibes-based.

## 5. The first version
**One screen, one flow, one outcome.** From Phase 1 Q3 and the contractor follow-up.

- **Platform:** the platform the v1 runs on first — web/PWA, native desktop, native mobile, or all-of-the-above from one codebase web-first. (From the Phase 1 prelude.)
- **Input:** what the user gives the product. (Phase 1 Q4.)
- **Output:** what they walk away with. (Phase 1 Q4.)
- **The one screen it lives on:** named, described in two sentences, with explicit reference back to section 4's canon (e.g. *"sibling mode of the existing welcome page in `src/renderer/index.html`; reuses the warm cream surface and the existing nav chrome"*).
- **What's deliberately not in v1:** at least three things the user explicitly cut. (From Phase 1 Q5 and any scope-cutting in Phase 2.)

## 6. First-time experience
What the user sees on first open. From AskUserQuestion Q3. Walk through the first 30 seconds, step by step — what's on screen, what they tap, what they see next. Every visual element described here must reference the canon in section 4 by name (e.g. *"the existing primary button style"*, *"the cream surface from `styles.css`"*).

## 7. The shape of the product
From AskUserQuestion Q2 plus the always-ask follow-up. One paragraph: page, feed, tool, space, or conversation — AND, if conversation or tool, the **specific** shape (chat / onboarding flow / wizard / other). The chat-vs-onboarding-flow distinction is non-negotiable: name it explicitly here so the agent doesn't default to a chat layout when an onboarding flow was meant. Section 9 names the corresponding anti-pattern.

## 8. The loop (or: no loop)
From AskUserQuestion Q1 + Q4. Either describe what brings the user back, or honestly state *"This is one-and-done; there is no return loop, and that's fine."* Don't fabricate a loop because products are "supposed to" have one.

## 9. The line — what this product won't do
From Phase 1 Q5. Three to five concrete bullets. The features you'll say no to even when a user asks. These are part of the product, not the absence of product.

**If the user named "no AI-written content" or any similar principle, do not stop at the principle.** Make it operational. Add a sub-section titled *"Visible-string allowlist"* with this exact mechanic:

> Every visible string on the rendered page must be one of:
> - (a) a verbatim quote from the founder's transcript / input, OR
> - (b) a fixed UI string from this allowlist: `[list every button label, header, microcopy string the page needs — derived from sections 5 and 6]`.
>
> Anything outside (a) or (b) is a bug. Before the agent considers v1 done, it runs a check: walk every text node on the rendered page; verify each is either in the founder's transcript or in the allowlist. The check is a build step, not a vibe.

Producing the allowlist is the agent's job during Phase 3 synthesis. Be exhaustive — include every literal string that should appear on the screen. If you don't know one, leave `[NEEDS INPUT: literal text for the X button]` rather than guessing. The allowlist becomes a constraint in the build prompt.

## 10. The hard part
From AskUserQuestion Q5 + Q6. Where the user expects this to break, and what they'd watch for to catch it early.

## 11. Build sequence
A numbered list — what to build first, second, third. Each item is **one screen or one capability**, never a vague phase like "core platform" or "infra". From the contractor follow-up + the v1 answer. Each step that produces visible UI must reference section 4's canon and section 9's allowlist. If the user only gave you enough for step 1, list step 1 honestly and write `[NEEDS INPUT: what comes after the first screen ships]` for the rest.

## 12. How you'll know it's working
Two or three concrete signals — observable behavior, not vanity metrics. *"My barber sends his nephew."* *"Someone I don't know puts $20 in."* *"The third user finishes the form without messaging me."* If the user didn't give you signals, ask once via **AskUserQuestion** with concrete-signal options (e.g. *"A stranger finishes the core flow"*, *"Someone pays / commits money"*, *"A user I didn't recruit comes back next week"*, *"Word of mouth — someone tells someone else"*); if still nothing, leave `[NEEDS INPUT: signals]`.

## 13. Open questions
Anything you couldn't nail down in the interview. List them as questions the user has to answer before the first line of code, not as TODOs.
```

### Versioning

Every run of this skill produces a versioned build prompt so iterations are traceable.

Mechanic:
1. Before writing, check if `build-prompt.md` already exists in the working directory.
2. If it does, find the line `> Version: v{N}.{M}` near the top. Parse `M` as an integer. Increment by 1. The new version is `v{N}.{M+1}`.
3. If no existing file, the first version is `v0.100`.
4. After `v0.999`, the user can manually bump major: `v1.000`.

Examples: `v0.100` → `v0.101` → `v0.102` → ... → `v0.999` → (manual bump) → `v1.000`.

The version line goes near the top of the build prompt, right under the title.

### Build prompt template

```markdown
# Build [product name]

> Version: v[N.M]
> Generated by the product-spec skill.

Build the v1 of [product name] from this prompt. The user has already worked through a guided interview that distilled the idea into the structure below; this is the imperative form.

## Anti-patterns — do not repeat

[For each anti-pattern from scaffold section 9 + the UI-shape anti-pattern from scaffold section 7:]
- **Don't [negative-form description].** [Why this fails — one sentence.]

## Read first

[For each path in scaffold section 4 (visual + structural canon):]
- `[file path]` — [what it provides]

Plus: `README.md`, `package.json`.

## What you're building, in one paragraph

[Scaffold section 3 — verbatim or compressed.]

## Phase plan

[If platform target = "all of the above from one codebase, web-first":]
- **Phase 1 — Web/PWA.** Build everything as a web app served from `src/renderer/` (or equivalent) over a local server. Test in a desktop browser. Pause for explicit user approval before Phase 2.
- **Phase 2 — Native shells (only after approval).** Smoke-test Electron + Capacitor (iOS, Android) with the same renderer. Add the PWA manifest + icons for "Add to Home Screen."

[If platform target = single (web-only / desktop-only / mobile-only):]
- **Single-phase build.** Target [platform] only.

## Build sequence

[For each step in scaffold section 11:]

[N]. **[Step title].** [Step content.]

   [If the step produces a user-visible surface, add:]
   **CHECKPOINT — stop and report.** [What to run, what to confirm with the user before continuing.]

## Constraints (non-negotiable)

[From scaffold section 9 + section 4 + UI-shape anti-pattern:]
- **[Content principle in negative form]** (e.g., "AI never authors — no AI-written sentences").
- **Not a [chat / blank canvas / etc.]** (the UI-shape anti-pattern from scaffold section 7).
- **Inside the existing shell.** [Paths from scaffold section 4.]
- [Other constraints derived from the scaffold.]

## Open questions — ask the user, don't invent

[From scaffold section 13.]

If you must move forward without an answer, mark `[NEEDS INPUT]` in a code comment and pick a sensible default.

## Done when

[From scaffold section 12 + per-phase done-when checks.]

Report back: a description of each major surface, plus any `[NEEDS INPUT]` decisions you marked.
```

### Filling the template

For each placeholder above, pull content from the internal scaffold:
- **Anti-patterns:** rewrite scaffold section 9 bullets and section 7's UI-shape constraint into negative form ("Don't build a chat layout with text area at the bottom.").
- **Read first:** enumerate every file path mentioned in scaffold section 4 (visual + structural canon).
- **What you're building:** scaffold section 3, verbatim or tightened.
- **Phase plan:** branch on the platform-target answer captured in Phase 1 prelude.
- **Build sequence:** scaffold section 11, with checkpoints inserted at user-visible milestones (typically after the first surface ships).
- **Constraints:** combine scaffold section 9 (the line) with section 4 (canon) and section 7 (UI shape).
- **Open questions:** scaffold section 13 verbatim.
- **Done when:** scaffold section 12, plus per-phase verification (e.g., "PWA done when `npm run web` opens the app and the welcome page is X").

### When the build prompt is done

Read it back as a one-line summary: *"Build prompt v[N.M] is at `build-prompt.md`. Hand this to a fresh build agent or to yourself in three weeks."*

Then **paste the full contents of `build-prompt.md` back into the chat inside a fenced ```markdown code block** so the user can copy and paste it directly into a fresh agent, another tool, or anywhere else they want to run it. The file on disk and the pasted block must be identical — do not summarize, trim, or reformat. This is non-negotiable: the user is often working from the chat surface and can't easily grab the file, so the copy-paste block is how the artifact actually reaches them.

If the user wants edits, edit the file in place — don't rewrite from scratch — then re-paste the updated full contents in the same way.

### Optional: also write product-spec.md

By default, do **not** write `product-spec.md`. The descriptive form lives only in your internal scaffold; the imperative form (`build-prompt.md`) is what's stored.

If the user explicitly asks for the descriptive doc — *"can I see this as a spec too?"*, *"give me the full product spec"*, *"write the spec form"* — write `product-spec.md` to the working directory using the 13-section scaffold above, populated with the same content the build prompt was derived from. This is a snapshot, not a living artifact; the build prompt remains the canonical, versioned output.

---

## Tone rules for the whole conversation

- Talk like a builder friend who's shipped a few things, not a product manager. Plain language always.
- **Never invent product details, users, screens, features, or metrics.** Every concrete claim in `build-prompt.md` traces to something the user said. If a section needs information you don't have, leave a `[NEEDS INPUT: …]` placeholder rather than filling it in.
- Never use the words *MVP*, *retention*, *funnel*, *acquisition*, *PMF*, *flywheel*, *iterate*, *go-to-market* with the user. Translate silently.
- If the user wants v1 to do six things, push back **once**: *"If we ship one of those next month and the rest later, which one?"* Honor the answer.
- If the user describes a feature without a person attached, ask via **AskUserQuestion**: *"Who's using that, and what does it feel like for them?"* with 3–4 plausible person-archetypes drawn from the conversation + Other — anchor every feature to a person.
- If the user is genuinely pre-everything (no sketch, no screen, no draft), **say so honestly** in the build sequence. Don't pad it with placeholder steps.
- **If the product lives inside an existing app, the new screen inherits — never invents.** Buttons, fonts, colors, containers, spacing, AND structural primitives (sidebar, tabs, address bar, navigation, modals, welcome page) all come from the host app's existing files. Read `README.md` and a representative slice of `src/` first to understand the existing shell. The build prompt's "Read first" and "Constraints" sections must enumerate BOTH visual AND structural inheritance by file path — visual without structural produces builds the agent treats as a new screen bolted onto the existing app, and the founder looks at the result and says *"that's not my app."* The canon is the difference between "feels like mine" and "feels like a generic AI-shaped UI."
- **If the line includes a content principle (e.g. "no AI-written words"), turn it into an allowlist constraint, not a vibe.** Principles get rationalized away by agents; explicit allowlists get checked. Force the build prompt to enumerate every visible string in its constraints section.
- **Name the UI-shape anti-pattern, not just the aspiration.** If the user wants an onboarding flow, the build prompt must explicitly say *"not a chat layout — no persistent text area at the bottom, no message-thread scroll, no bubbles."* If the user wants a feed, the build prompt must say *"not a search-result list."* Aspirations get drifted away from; anti-patterns get followed. Without the negative form, an agent reading the build prompt defaults to a ChatGPT-shaped UI for anything conversational.
- Celebrate clarity briefly and move on. *"That's the one. Keep going."*

## When the build prompt is done

After writing `build-prompt.md`:

1. Read it back as a 4–5 line summary and point out any `[NEEDS INPUT: …]` placeholders the user needs to fill.
2. **Paste the full contents of `build-prompt.md` into the chat inside a fenced ```markdown code block**, byte-identical to the file on disk. This is the copy-paste handoff — the user is often on a chat surface where grabbing a file is awkward, and the pasted block is how the artifact actually reaches them. Do not summarize, abridge, or "show the important parts" — paste the whole thing.
3. Then ask via **AskUserQuestion**: *"Does this match the thing you have in your head, or do we tighten anywhere?"* with options like *"Yes, this is it — ship the prompt"*, *"Mostly, but tighten one section"*, *"The first version is bigger than what I'd actually build first"*, *"Something fundamental is off — let's revisit"*.

If they want edits, edit the file in place — don't rewrite from scratch unless they ask — and re-paste the updated full contents in the same fenced block.

## Tools to use

- **Read** — load `pitch-deck.md` if it exists, for background. Also load `README.md` and skim `src/` if they exist (so structural inheritance in the build prompt is concrete). And load any prior `build-prompt.md` to read its current version, so Phase 3 can increment.
- **AskUserQuestion** — every question the user is asked, across all phases: the Phase 1 prelude, the five Phase 1 foundation questions, Q1 through Q7 in Phase 2, the Q2 UI-shape follow-up, and the three always-ask follow-ups (F1, F2, F3). This is the question loader; do not replace it with free-form chat for any of these. The "Other" option is always available in the loader, so open-ended answers remain possible without dropping into plain-chat prompts. Q7 (visual canon) is the one most often skipped by accident — do not skip it; skipping it produces builds the agent treats as a greenfield design brief. Reflections back to the user stay in plain chat — those are confirmations, not questions.
- **Write** / **Edit** — produce and refine `build-prompt.md` (Phase 3). Optionally `product-spec.md` if the user explicitly asks for the descriptive form.
