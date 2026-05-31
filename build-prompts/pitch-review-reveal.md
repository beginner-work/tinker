# Build the post-publish placement flow — "be told where it landed, once it's true"

> Version: v0.110
> Reconstructed from shipped code by the build-prompts audit (2026-05).

Build tinker's post-publish flow: what the founder sees after publishing an
essay, and how they learn which pitch it became part of.

This replaces the older post-publish "arrangement" review screen. That screen
narrated the server-side organize job phase-by-phase (reconsidering → settling →
locked) and, after a single round, announced a placement — often "You found a
new direction." The problem: the backend re-clusters on every later writing
change, so the essay it announced as a new direction would quietly get folded
into another pitch seconds (or a session) later. The screen had told the founder
something that wasn't true yet. The fix is to **make no claim until the placement
is settled**, and deliver that claim as a notification rather than a live screen.

## Anti-patterns — do not repeat

- **Don't announce a placement that can still move.** The organize job runs again on every later writing event (`tinker:writing-saved`, `tinker:auth-changed`, the debounced `scheduleOrganize`). Never surface "it landed in X" off a single round. Wait until rounds have drained.
- **Don't block the founder on a reveal.** Publishing should let them keep moving immediately. The placement answer arrives later, on its own, without holding the screen hostage.
- **Don't turn it into a dashboard.** The founder's hard line: *"never become a busy dashboard."* No stat grids, no filters, no row of competing buttons.
- **Don't fabricate a reason or summary.** Every visible string is grounded in real data (the pitch's name, the slide heading, the essay title) or a fixed UI string. tinker never invents prose for the founder.
- **Don't lose the answer if they leave.** If the placement settles while the founder is away, the notification waits for them on the next visit — it is not dropped.

## Read first

- `src/renderer/renderer.js` — the post-publish flow lives here: `showPitchAssessing(essay)` renders the confirmation, `watchPlacement(essay)` waits for the organize job to settle, and `emitPlacementNotification(essay)` builds the payload. `closeApp()` backs the "Close app" button. The `tinker:open-pitch` listener routes a clicked toast to the pitch the essay joined.
- `src/renderer/notifications.js` — the native-style toast component. `window.tinkerNotify(payload)` shows/persists a notification; unseen ones (emitted while the tab was hidden/closed) re-surface on the next visit via `flushUnseen()`.
- `src/renderer/pitches.js` — pitch state + API on `window.tinkerPitches`: `findPitchForWriting`, `getPitch`, `setActivePitch`, `triggerOrganizeNow`, `scheduleOrganize`. It fires `tinker:organize-started` / `tinker:organize-completed` around each round.
- `src/renderer/styles.css` — `.assessing__*` (confirmation screen) and `.tinker-toast*` / `.tinker-toasts` (the toast stack).
- `src/renderer/index.html` — the `#writing-fit` section (repurposed as the assessing surface) and the `notifications.js` script tag.
- `src/main/preload.js` + `src/main/main.js` — `window.tinker.close()` ↔ the `app:close` IPC handler that closes the desktop window.
- `README.md`, `package.json`.

## What you're building, in one paragraph

When the founder publishes, drop them onto a calm confirmation — **"Your pitch is
being assessed."** — with two choices: a purple forward **"Keep writing →"** (opens
a fresh writing session) and a transparent **"Close app"** (closes the
window / standalone PWA, falling back to the feed on a plain web tab). In the
background, watch the organize job. Once it has **settled** — a round completed and
no further round started within a short grace window — read where the essay
actually landed and fire a **native-style toast** notification: *"'<title>' found
its place — Landed in '<pitch>' on the <slide> slide."* Clicking it opens that
pitch. If the founder has left, the notification is persisted and shown the next
time the site is in front of them.

## Phase plan

- **Single-surface build, web-first.** tinker ships one `src/renderer/` codebase across web/PWA, Electron, and Capacitor (see README). This flow is renderer-only except the `app:close` IPC; building/testing in a desktop browser (`npm run web`, or `npx vercel dev` for the authed flow) covers the web/PWA shells. The desktop close path needs Electron (`npm start`).

## Build sequence

1. **The confirmation screen.** On publish, render `showPitchAssessing(essay)` into the `#writing-fit` section: a quiet pulse mark, the crumb "You created another essay", the headline "Your pitch is being assessed.", a grounded sub-line naming the essay, and two actions — purple **"Keep writing →"** (`window.tinkerNewSession()`), transparent **"Close app"** (`closeApp()`). The two buttons mirror the writing footer's purple "Next" + outlined "This is everything" pairing.
   **CHECKPOINT — stop and report.** Confirm publishing lands here (not on a reveal that names a pitch), and both buttons work in web + desktop.

2. **The settle-watcher.** `watchPlacement(essay)` listens for `tinker:organize-started` / `tinker:organize-completed`. On completion it arms a short grace timer (`SETTLE_GRACE_MS`); a new round cancels it. A first-wait timer (`FIRST_WAIT_MS`, longer than `ORGANIZE_DEBOUNCE_MS`) covers the case where no round ever runs (nothing drifted, or no auth token); a `MAX_WAIT_MS` ceiling guarantees it resolves. A monotonically increasing token makes a second publish supersede the first.
   **CHECKPOINT — stop and report.** Confirm the watcher fires exactly once, only after rounds drain, and never contradicts itself when a later round moves the essay.

3. **The notification.** `emitPlacementNotification(essay)` reads `findPitchForWriting`, builds a grounded payload (pitch name + slide, or an "on its own for now" line when unplaced), and calls `window.tinkerNotify`. `notifications.js` shows a native-style toast (slide-in, stack, auto-dismiss, pause-on-hover, dismiss button) and persists it. Clicking a placement toast dispatches `tinker:open-pitch`; the renderer makes that pitch active and goes home. Unseen notifications re-surface on next visit.
   **CHECKPOINT — stop and report.** Demo: (a) settle while present → toast appears live; (b) settle while the tab is hidden, then return → toast appears on focus; (c) the unplaced case reads as additive, not a miss.

## Constraints (non-negotiable)

- **No premature placement.** Nothing names where the essay landed until `watchPlacement` resolves. The confirmation screen makes no claim.
- **Grounded copy only.** Visible strings are either a real data value (essay title, pitch name, slide heading) or a fixed UI string from this flow's vocabulary: `You created another essay`, `Your pitch is being assessed.`, `Keep writing →`, `Close app`, `found its place`, `Landed in`, `on the … slide`. Anything outside that is a bug.
- **Additive framing.** An essay that stands on its own is *"gathering a pitch of its own"* — never a miss, an orphan, or a thing that "didn't fit." *"None of them are unnecessary."*
- **The answer survives leaving.** A notification emitted while the founder is away is persisted (capped) and shown on the next visit. Never dropped.
- **Not a dashboard, not a feed.** One calm confirmation; one toast at a time per placement.

## Open questions — ask the founder, don't invent

- **A persistent notifications inbox?** Today notifications are toasts that re-show once if unseen, then settle into `localStorage` history with no UI to browse them. If the founder wants a bell/inbox to revisit past placements, that's a follow-on surface — confirm before building it.

If you must move forward without an answer, mark `[NEEDS INPUT]` in a code comment and ship the toast-only behavior above.

## Done when

- Publishing lands on "Your pitch is being assessed." with working "Keep writing →" and "Close app" actions — and names no pitch.
- A placement toast fires only after the organize job settles, and says where the essay actually landed (pitch + slide), or that it's standing on its own.
- A placement that settles while the founder is away shows up on their next visit.
- Clicking a placement toast opens the pitch the essay joined.
- No copy frames any landing as a miss; nothing reads as a dashboard.

Report back: a description of the confirmation screen, when the toast fires
relative to the organize rounds, the live vs. came-back-later paths, and any
`[NEEDS INPUT]` decisions you marked.
