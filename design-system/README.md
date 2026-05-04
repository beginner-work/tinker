# tinker Design System

> *A quiet place to be on the web.*

This is the design system for **tinker** — a minimal desktop browser
(Electron) that also ships as a mobile app (Capacitor) from the same
`src/renderer/` codebase. It's calm, warm, paper-coloured, and
deliberately unbusy: a small wordmark, a sprouting seed mark, and a
welcome page that asks one question.

The system is layered:

- **Company brand** comes from **beginner** — the founder behind
  tinker, and the parent identity used in the locked pitch deck. The
  brand mark is the **seed**, the brand wordmark is **beginner** in
  lowercase Plus Jakarta Sans, and the brand colour is **forest green
  `#2d5a3d`**. Anywhere this system needs to *speak as a company*
  (footers of decks, About pages, investor materials), the seed +
  "beginner" is what shows up.
- **Product brand** is **tinker** — the browser itself. Inside the
  product the wordmark is "tinker" in lowercase, and the in-product
  globe ("rainbow-web") appears in the sidebar. The product still
  sits on the company colour palette; it just uses its own wordmark
  and product mark in-app.

The two layers share every other token — surfaces, type, spacing,
shadow, motion. Only the wordmark and the mark differ. So when you
see "company brand" or "product brand" below, that's what's meant.

This system also covers **the founder marketplace platform** — a
sibling product still at the pitch stage in the same repository
(`pitch-deck.md`). The platform doesn't have its own implemented UI
yet, so design work for it borrows tinker's calm-paper foundations
plus the deck's voice.

## Sources

Everything in this system was derived from the working tinker
codebase. Production tokens live in `src/renderer/styles.css`
(extended in this same commit) and `src/renderer/tokens/rainbow-web.json`.

| Source | What's there |
|---|---|
| `src/renderer/styles.css` | tinker browser chrome — the canonical token block |
| `src/renderer/tokens/rainbow-web.json` | rainbow-web product mark dictionary |
| `pitch-deck.md` | Founder-platform pitch (text only) |
| `pitch-narrative-{family,friend}.md` | Two narrative drafts of the pitch |

## What's in this folder

| File / folder | What it holds |
|---|---|
| `colors_and_type.css` | Every design token as CSS custom properties + base element styles. Import this and you have tinker's foundations. |
| `assets/` | Both marks side-by-side: the **seed** (company) and the **rainbow-web** (product). Each ships as full-colour SVG, mono SVG, and a JSON token dictionary. |
| `preview/` | Small standalone HTML cards that demo each foundation (typography, colors, components). |
| `ui_kits/tinker-browser/` | Pixel-faithful React recreations of tinker's chrome — sidebar, welcome page, search-results pane, etc. |

---

## Content fundamentals

How tinker writes — derived from the welcome page, error states, the
pitch deck, and the two narrative drafts.

### Voice

- **Calm. Plainspoken. Unhurried.** Sentences are short and arrive
  one at a time. There's almost always white space around the
  important line.
- **Confident without selling.** The product describes what it does
  and stops. No exclamation points. No urgency words. No "revolutionary",
  no "powerful", no "blazing fast".
- **Direct address — "you" is fine; "we" is rare.** The pitch deck
  does it explicitly: "warm, plainspoken, calm. Address the reader
  as 'you' where natural."
- **Quiet, not cute.** No emoji anywhere in the codebase. No
  exclamation marks in product copy. The only punctuation
  flourish you'll see is the em dash (—) and the ellipsis (…).
- **Honest about limits.** Errors say what's wrong, what to do, and
  end.

### Casing

- **Brand wordmark is lowercase: `tinker`.** Always.
- **Sentence case for everything else** — buttons, labels, page
  titles. "New session", "Begin", "Start a new web", "Reading the
  room…". Not Title Case.
- **UPPERCASE with letter-spacing for tiny labels only** — 11px,
  semibold, `letter-spacing: 0.06em`–`0.08em`.

### Vocabulary it avoids

- "Tab" → use **session**.
- "Search engine", "results" → use **search**, **the essay**, **the
  answer**.
- Marketing intensifiers (powerful, fastest, beautiful, simply,
  literally).
- AI-pitch tropes (delight, supercharge, unlock, leverage, seamless).

### Vibe, in one line

> Paper. Quiet. The opposite of urgent.

---

## Visual foundations

Verified against `src/renderer/styles.css` and the running app —
these are not aspirational, they are what's shipping.

### Colors

A two-temperature system: a **warm cream/parchment** wash for
surfaces, with **deep forest green** for brand and **indigo-500** for
primary action. The logo carries its own rainbow palette but the
rainbow does not appear in UI surfaces.

- **Page is `#fffdf7`** — warm white, never pure white.
- **Cards step up to `#fff9f0`**, which is *warmer* than the page,
  not lighter.
- **Hairline borders are `#ede8e0`** — the only stroke colour for
  dividers.
- **The wordmark colour is `#1a1a1a`** (`--color-ink`); body text is
  `#2d2a26` (warmer still).
- **Forest green `#2d5a3d`** is the calm brand colour.
- **Indigo-500 `#6366f1`** is the primary CTA colour — only on the
  big "Begin" button on the welcome page, on links, and on the
  focus ring.

### Typography

Two faces: **Plus Jakarta Sans** (display + the search-essay reading
voice) and **Inter** (everything else). No third face. The mono
stack is the system default and only inline `code` ever uses it.

The scale is small: 38, 22, 17, 15, 14, 13, 11. There is no 12, no
16, no 18, no 20, no 24 in production.

### Spacing

`4 / 6 / 8 / 12 / 16 / 24` — that's it.

### Radii

There are exactly five values in production:
- **999px** — the search field, the "Begin" button (capsules)
- **44px** — only the logo's own rounded-square plate
- **12px** — cards, error tiles
- **10px** — most buttons, the sidebar's "New session" pill
- **9px** — sidebar session items
- **8px** — icon buttons

Don't add a sixth.

### Shadows

Two named tints. Both have a tiny 1px contact + a soft 4–18px ambient.

- **`--shadow-soft`** — green-tinted (`rgba(45, 90, 61, ...)`).
- **`--shadow-purple`** — indigo-tinted (`rgba(99, 102, 241, ...)`).
  Reserved for the primary "Begin" CTA.

The focus ring is **a 4px indigo halo at 18% opacity** —
`0 0 0 4px rgba(99, 102, 241, 0.18)`.

### Animation

The app barely moves. Everything that moves uses `ease` over
`120–200ms`.

| Where | Duration |
|---|---|
| Hover background fade | `0.12s ease` |
| Search-field focus ring | `0.15s ease` |
| Button press scale | `0.05s ease` |
| Loadbar slide | `1.2s ease-in-out infinite` |
| Thinking dots | `1.2s ease-in-out infinite` |
| Session spinner | `0.7s linear infinite` |

No bouncy springs. No long page transitions. No parallax.

---

## Iconography

tinker uses **inline SVG, hand-tuned for the chrome**. There's no
icon font, no Heroicons / Lucide CDN, no PNG icons.

### Style rules

- **All strokes, no fills.** `fill="none"` plus `stroke="currentColor"`
  so colour comes from CSS.
- **Round joins and round caps** — `stroke-linejoin="round"`,
  `stroke-linecap="round"`. Never miter.
- **Stroke weight scales with icon size**: 1.4–1.6 at 14px, 2 at 15–24px.
- **Icons are the foreground colour by default.**
- **Emoji never appear.**

### Lockups

- **Company:** seed + "beginner" — used horizontally on nav-style
  surfaces and stacked on hero/marketing surfaces.
- **Product (tinker):** rainbow-web globe + "tinker" — only inside
  the browser's own chrome.

The two lockups never appear in the same line of sight. Decks lead
with the seed; the browser leads with the globe.
