# Reading agent embed (milestone 1)

Embeddable widget that reads a **public article URL** aloud, accepts spoken
or typed interrupt questions, answers with Claude grounded in the page
(fetching linked sources via tool use when needed), then resumes.

Served from the Tinker Vercel deploy (`tinker.beginner.work`). Designed for
one essay on [lindowlabs.dev](https://lindowlabs.dev) (repo `tlindow/lindowlabs`).

This doc is the embed change for lindowlabs. Visual follow-up details and
a Tinker-hosted preview live in
[`docs/lindowlabs-reading-embed-patch.md`](lindowlabs-reading-embed-patch.md)
(`/reading-widget/lindowlabs-preview`). The real site PR must land in the
private lindowlabs repo once that access is available — **do not merge**
the visual follow-up until Tyler reviews screenshots.

## What hosts must not do

- Do not put `TINKER_SERVICE_TOKEN`, `ANTHROPIC_API_KEY`, or
  `ELEVENLABS_API_KEY` in browser JS.
- Do not vendor third-party article HTML into the lindowlabs or Tinker
  repos. Pass a public URL; Tinker fetches at runtime and links back with
  author attribution.
- Never use ElevenLabs voice id `JlYdFGRHWwlz51Zh5K2n` (Tyler's personal
  voice). The reader uses stock Savvy (`ogwqBH5bbF03DSbNiRNN`) unless
  `READING_VOICE_ID` overrides it on Production.

## Resume metrics

Definitions and event-name contract: [`RESUME_METRICS.md`](../RESUME_METRICS.md).
The embed script passes the parent hostname as `embedHost` into the iframe
so SDK embed-host counts exclude Tinker's own origin. Owner QA uses
`?owner=1` (or `data-owner="1"` on the script tag) so those sessions are
dropped from resume numbers.

## Recommended: iframe via script tag

On the target essay page in `tlindow/lindowlabs`, add:

```html
<!-- Tinker reading agent (milestone 1). Served from tinker.beginner.work. -->
<script
  src="https://tinker.beginner.work/reading-widget/embed.js"
  data-url="https://lindowlabs.dev/essays/YOUR-ESSAY-SLUG"
  data-mode="iframe"
  data-height="520"
  async
></script>
```

Replace `YOUR-ESSAY-SLUG` with the live essay path. The script injects an
iframe pointed at `/reading-widget/?url=…&embed=1` on Tinker. The widget
talks same-origin to `/api/reading`.

### Optional attributes

| Attribute | Meaning |
| --- | --- |
| `data-url` | Public article URL to read (required for auto-start) |
| `data-mode` | `iframe` (default) or `proxy` |
| `data-height` | iframe height in px (default `520`) |
| `data-target` | CSS selector to mount into (otherwise inserts after the script) |
| `data-autoplay` | `true` to start listening after session create |
| `data-proxy-url` | Host proxy origin for `data-mode="proxy"` (no trailing slash) |

## Alternate: host proxy mode

If the essay page must keep the widget in-DOM (no iframe), run a tiny
same-origin proxy on lindowlabs that forwards to Tinker with
`TINKER_SERVICE_TOKEN`, then:

```html
<script
  src="https://tinker.beginner.work/reading-widget/embed.js"
  data-url="https://lindowlabs.dev/essays/YOUR-ESSAY-SLUG"
  data-mode="proxy"
  data-proxy-url="/api/tinker-reading"
  async
></script>
```

Proxy contract (POST JSON unless noted):

| Host path | Upstream |
| --- | --- |
| `POST /api/tinker-reading/api/reading?action=session` | `POST https://tinker.beginner.work/api/reading?action=session` |
| `POST …/api/reading?action=speak` | same on Tinker |
| `POST …/api/reading?action=ask` | same on Tinker |
| `POST …/api/reading?action=event` | same on Tinker |

Forward `Authorization: Bearer <TINKER_SERVICE_TOKEN>` and optional
`X-Tinker-Caller: lindowlabs.dev` from the host server only.

A simpler proxy can strip the duplicated `/api/reading` prefix; if so,
point `data-proxy-url` at the prefix your rewrite expects and adjust
`widget.js` mounting accordingly. Iframe mode needs no host proxy.

## Any public article URL

The reader is not limited to a hardcoded lindowlabs corpus. Pass any
public `https` article (company engineering blogs, docs posts, etc.).
Tinker:

1. Fetches the page at runtime (SSRF-safe).
2. Extracts title, author, plain text, and outbound links.
3. Reads aloud via ElevenLabs.
4. Answers interrupts from the page text; may call `fetch_linked_source`
   for an outbound link when the question needs it.
5. Logs `sourceUrl` + `companyHost` per session for per-company metrics.
6. Does **not** check article bodies into git.
7. Credits the author and links back to the original URL in the widget.

### First target source (Sierra)

Milestone 1 demos use a real Sierra engineering post:

`https://sierra.ai/blog/gardening-week-evergreen-engineering`

(title *Gardening Week: Evergreen Engineering*, author Mihai Parparita).
The widget attributes the piece and the "Original article" footer opens
that URL. Replace `data-url` with any other public Sierra (or other
company) post when embedding.

Demo:
`https://tinker.beginner.work/reading-widget/?url=https%3A%2F%2Fsierra.ai%2Fblog%2Fgardening-week-evergreen-engineering`

## API surface (Tinker)

`/api/reading?action=`

| Action | Method | Purpose |
| --- | --- | --- |
| `session` | POST | `{ url }` → session metadata (no full article body in response) |
| `speak` | POST | `{ sessionId, fromWordIndex? }` → MP3 chunk + resume cursor |
| `ask` | POST | `{ sessionId, question, input, position? }` → answer + audio + resume |
| `event` | POST | `{ sessionId, target: linkedin\|email\|source\|resume }` |
| `metrics` | GET | Aggregate counts (service token or signed-in owner) |

## Metrics logged

| Metric | Where |
| --- | --- |
| Sessions started | `ReadingSession` (+ `sourceUrl`, `companyHost`) |
| Questions asked | `ReadingQuestion` |
| Linked source fetched | `ReadingQuestion.fetchedSource` / `fetchedSourceUrl` |
| Answer latency | `ReadingQuestion.latencyMs` |
| Clicks to LinkedIn / email / source | `ReadingClick.target` |

Print counts:

```bash
DATABASE_URL=… node scripts/reading-metrics.js
DATABASE_URL=… node scripts/reading-metrics.js --json
```

## Production env (Vercel Production only)

- `ANTHROPIC_API_KEY`
- `ELEVENLABS_API_KEY`
- `TINKER_SERVICE_TOKEN`
- `DATABASE_URL`
- `READING_VOICE_ID` (optional; default stock Savvy)
- `READING_MODEL` / `ASK_MODEL` (optional)
- `READING_PUBLIC_SESSIONS` (optional; default allow widget bootstrap; set `0` to require token for session create)
