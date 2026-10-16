# Visual regression tests

Playwright `toHaveScreenshot` locks the main hosted surfaces at two viewports:

- Desktop: `1440x900` (`desktop-1440`)
- iPhone PWA width: `390x844` (`iphone-390`)

Screens covered (static harnesses, no live Claude/API):

- `/repo` writing surface (`essay-question-overlap.html`)
- Mobile `/repo` first screen — essay writing (`mobile-writing-first.html`)
- Learning loop after apply (`learning-loop-after.html`)
- Learning loop attempt (`learning-loop-attempt.html`)
- Lesson step markdown preview (`desktop-step-md-preview.html`)
- Mobile essay / That's everything foot (`mobile-essay-list.html`)

Fixtures freeze time to `2026-10-15T12:00:00.000Z`, disable animations/transitions, and stub `/api/**`.

## Run locally

```bash
npx playwright install chromium
npm run test:visual
```

CI runs the same command on every pull request and push to `main`. Diffs fail the build.

## Update baselines

When a deliberate UI change updates pixels:

```bash
npm run test:visual:update
```

That rewrites PNGs under `tests/visual/main-screens.spec.js-snapshots/`. Commit the new baselines in the same PR as the UI change. Review the diff carefully: unexpected churn usually means a non-deterministic fixture (fonts, time, animation) rather than a real design change.

## Capture before/after evidence

```bash
node scripts/capture-visual-harness.mjs /opt/cursor/artifacts/before
# …make UI changes…
node scripts/capture-visual-harness.mjs /opt/cursor/artifacts/after
```
