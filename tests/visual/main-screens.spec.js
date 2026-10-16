/**
 * Visual regression for main hosted surfaces.
 * Fixtures are static harness HTML (no live Claude/API). Time + motion frozen.
 */
const { test, expect } = require("@playwright/test");

const SCREENS = [
  {
    name: "repo-writing",
    path: "/repo/harness/essay-question-overlap.html",
  },
  {
    name: "repo-exercises-sidebar",
    path: "/repo/harness/exercises-module-sidebar.html",
  },
  {
    name: "repo-step-preview",
    path: "/repo/harness/desktop-step-md-preview.html",
  },
  {
    name: "repo-mobile-essay",
    path: "/repo/harness/mobile-essay-list.html",
  },
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const frozen = new Date("2026-10-15T12:00:00.000Z").getTime();
    Date.now = () => frozen;
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(frozen);
        else super(...args);
      }
      static now() {
        return frozen;
      }
    };
  });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
      /* Stabilize webfont first-paint for diffs. */
      html { font-display: block; }
    `,
  });
});

for (const screen of SCREENS) {
  test(`${screen.name}`, async ({ page }, testInfo) => {
    // Stub Claude / API so harnesses never hit the network.
    await page.route("**/api/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, mocked: true }),
      });
    });

    await page.goto(screen.path, { waitUntil: "networkidle" });
    await page.waitForTimeout(150);

    await expect(page).toHaveScreenshot(`${screen.name}.png`, {
      fullPage: false,
    });
  });
}
