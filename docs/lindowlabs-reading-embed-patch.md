# Lindowlabs.dev reading embed (follow-up — do not merge until visual review)

**Blocked on repo access:** this agent cannot clone `tlindow/lindowlabs`
(private / not visible to the GitHub integration). Until that access is
granted, the visual review surface is the Tinker-hosted preview:

`https://tinker.beginner.work/reading-widget/lindowlabs-preview`

When the site repo is available, apply the following on a blog post
template (e.g. `/blog/[slug]`) and open the PR **against the lindowlabs
repo**. Do not merge until Tyler reviews screenshots.

## 1. "Listen to this post" control

Near the post title (same first content band as the headline — not a
card stack of extras), add a single CTA that scrolls to / focuses the
embed, plus a secondary any-URL path to Tinker Reading:

```tsx
<a
  href="#tinker-reading"
  className="…your existing text-link / button styles…"
>
  Listen to this post
</a>
{/* Optional any-URL entry */}
<a
  href={`https://tinker.beginner.work/reading-widget/?url=${encodeURIComponent(canonicalPostUrl)}`}
  rel="noopener noreferrer"
>
  Open in Tinker Reading
</a>
```

`canonicalPostUrl` must be the public `https://lindowlabs.dev/blog/…`
URL for this post.

## 2. Embed snippet (iframe)

After the listen CTA (or at `#tinker-reading`):

```html
<div id="tinker-reading"></div>
<script
  src="https://tinker.beginner.work/reading-widget/embed.js"
  data-url="https://lindowlabs.dev/blog/YOUR-SLUG"
  data-mode="iframe"
  data-height="560"
  data-target="#tinker-reading"
  async
></script>
```

In Next.js App Router, load the script from a client component or via
`next/script` with `strategy="lazyOnload"`. Do **not** put
`TINKER_SERVICE_TOKEN` in the browser. Iframe mode talks same-origin to
Tinker.

## 3. Metrics / owner QA

- Parent hostname is passed as `embedHost` by `embed.js` (resume SDK host
  counts). `lindowlabs.dev` itself is excluded from embed-host metrics by
  contract (`RESUME_METRICS.md`).
- Owner QA: add `data-owner="1"` or open with `?owner=1` so sessions are
  excluded.

## 4. Any public URL

The same widget accepts any public article URL (first demo source:
Sierra). The "Open in Tinker Reading" link above is the any-URL entry.
