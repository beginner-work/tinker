/**
 * Geometry regression for the New essay FAB ↔ Keep crafting island dock.
 *
 * Asserts by bounding-box geometry (not pixel snapshots):
 * - right-anchored (right edge within ~16–24px of viewport right − safe inset)
 * - fully inside the viewport
 * - above the bottom safe-area inset
 *
 * iPhone harness: 393×852 standalone PWA with injected safe-area tokens
 * (home indicator 34px). Desktop: 1440×900 Electron-like viewport.
 *
 * This suite fails on main at 4d297ae (#545) where `.repo-panel__write >
 * .repo-surface__foot` was `position:absolute; left:0; bottom:0`, and passes
 * once the island shares the fixed bottom-right compose dock with the FAB.
 */
const { test, expect } = require("@playwright/test");

/** Comfortable gutter from the safe edges (matches --repo-compose-dock-*). */
const DOCK_GUTTER_MIN = 16;
const DOCK_GUTTER_MAX = 24;
/** Allow 1px subpixel / rounding drift. */
const PX_TOL = 1.5;

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 */
async function boxOf(page, selector) {
  const loc = page.locator(selector);
  await expect(loc).toBeVisible();
  const box = await loc.boundingBox();
  expect(box, `${selector} bounding box`).toBeTruthy();
  return box;
}

/**
 * @param {{ x:number, y:number, width:number, height:number }} box
 * @param {{ vw:number, vh:number, safeRight?:number, safeBottom?:number, label:string, gutterMin?:number, gutterMax?:number }} opts
 */
function assertRightDocked(box, opts) {
  const {
    vw,
    vh,
    safeRight = 0,
    safeBottom = 0,
    label,
    gutterMin = DOCK_GUTTER_MIN,
    gutterMax = DOCK_GUTTER_MAX,
  } = opts;
  const rightEdge = box.x + box.width;
  const bottomEdge = box.y + box.height;
  const distFromRight = vw - safeRight - rightEdge;
  const distFromBottom = vh - safeBottom - bottomEdge;

  expect(box.x, `${label}: left edge inside viewport`).toBeGreaterThanOrEqual(-PX_TOL);
  expect(box.y, `${label}: top edge inside viewport`).toBeGreaterThanOrEqual(-PX_TOL);
  expect(rightEdge, `${label}: right edge inside viewport`).toBeLessThanOrEqual(vw + PX_TOL);
  expect(bottomEdge, `${label}: bottom edge inside viewport`).toBeLessThanOrEqual(vh + PX_TOL);

  expect(
    distFromRight,
    `${label}: right-anchored (expected ${gutterMin}–${gutterMax}px from viewport right − inset; got ${distFromRight.toFixed(2)})`,
  ).toBeGreaterThanOrEqual(gutterMin - PX_TOL);
  expect(
    distFromRight,
    `${label}: not floating too far from the right edge (got ${distFromRight.toFixed(2)})`,
  ).toBeLessThanOrEqual(gutterMax + PX_TOL);

  // Comfortably above the home indicator / bottom safe inset (gutter ≥ 12px floor).
  expect(
    distFromBottom,
    `${label}: above bottom safe-area (clearance ${distFromBottom.toFixed(2)}px)`,
  ).toBeGreaterThanOrEqual(12 - PX_TOL);

  // Must not be left-docked (the #545 regression: left:0 / bottom:0).
  // A wide island may extend past mid-screen; the failure mode is flush left.
  expect(box.x, `${label}: must not sit flush on the left edge`).toBeGreaterThan(8);
}

test.describe("compose dock geometry", () => {
  test.describe.configure({ mode: "serial" });

  // Suite owns its viewports; skip the duplicate iphone-390 project run.
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-1440",
      "geometry suite owns iPhone 15 + desktop viewports",
    );
  });

  test("iPhone 15 standalone PWA: FAB and island are right-docked inside safe areas", async ({
    browser,
  }) => {
    const SAFE_RIGHT = 0;
    const SAFE_BOTTOM = 34;
    const VW = 393;
    const VH = 852;

    const context = await browser.newContext({
      viewport: { width: VW, height: VH },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", {
        configurable: true,
        get: () => true,
      });
      const orig = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        if (String(query).includes("display-mode: standalone")) {
          return {
            matches: true,
            media: query,
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() {
              return false;
            },
          };
        }
        return orig(query);
      };
    });

    const page = await context.newPage();
    await page.route("**/api/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, mocked: true }),
      });
    });

    // FAB state
    await page.goto("/repo/harness/compose-dock-iphone-pwa.html?state=fab", {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(100);
    const fab = await boxOf(page, "#repo-new-essay");
    assertRightDocked(fab, {
      vw: VW,
      vh: VH,
      safeRight: SAFE_RIGHT,
      safeBottom: SAFE_BOTTOM,
      label: "iPhone FAB",
    });

    // Island state (morph target — grows leftward from the same right anchor)
    await page.goto("/repo/harness/compose-dock-iphone-pwa.html?state=island", {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(100);
    const island = await boxOf(page, "#repo-pad-actions");
    assertRightDocked(island, {
      vw: VW,
      vh: VH,
      safeRight: SAFE_RIGHT,
      safeBottom: SAFE_BOTTOM,
      label: "iPhone island",
    });

    // Same right edge as the FAB (morph grows leftward).
    const fabRight = fab.x + fab.width;
    const islandRight = island.x + island.width;
    expect(
      Math.abs(fabRight - islandRight),
      `FAB and island share the right anchor (fab=${fabRight}, island=${islandRight})`,
    ).toBeLessThanOrEqual(2);

    await context.close();
  });

  test("desktop Electron: FAB and island are right-docked above the floor", async ({
    browser,
  }) => {
    const VW = 1440;
    const VH = 900;
    const floor = Math.max(48, Math.round(0.08 * VH)); // 72 on 900h

    const context = await browser.newContext({
      viewport: { width: VW, height: VH },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.route("**/api/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, mocked: true }),
      });
    });

    await page.goto("/repo/harness/compose-dock-desktop.html?state=fab", {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(100);
    const fab = await boxOf(page, "#repo-new-essay");
    assertRightDocked(fab, {
      vw: VW,
      vh: VH,
      safeRight: 0,
      safeBottom: 0,
      label: "desktop FAB",
      gutterMin: DOCK_GUTTER_MIN,
      gutterMax: DOCK_GUTTER_MAX,
    });
    expect(VH - (fab.y + fab.height)).toBeGreaterThanOrEqual(floor - PX_TOL);

    await page.goto("/repo/harness/compose-dock-desktop.html?state=island", {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(100);
    const island = await boxOf(page, "#repo-pad-actions");
    assertRightDocked(island, {
      vw: VW,
      vh: VH,
      safeRight: 0,
      safeBottom: 0,
      label: "desktop island",
    });
    expect(VH - (island.y + island.height)).toBeGreaterThanOrEqual(floor - PX_TOL);

    const fabRight = fab.x + fab.width;
    const islandRight = island.x + island.width;
    expect(Math.abs(fabRight - islandRight)).toBeLessThanOrEqual(2);

    await context.close();
  });
});
