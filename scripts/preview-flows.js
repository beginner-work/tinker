/* Flow definitions for the Browserbase preview walkthrough.
 *
 * Each flow is a self-contained recipe that walks Playwright through a
 * single product surface, takes a screenshot at the end, and returns.
 * The walkthrough harness wraps every flow in console-log capture and
 * error trapping, so flows themselves only have to describe the path.
 *
 * Add a new flow by appending an object to the exported array. Keep
 * `name` short and filesystem-safe — it becomes both the PNG filename
 * and the section heading in the PR comment.
 *
 * `auth: true` flows run with the Stytch session token pre-injected
 * into localStorage. Flows without `auth` (or with `auth: false`) run
 * against the unauthenticated app. If TINKER_TEST_SESSION_TOKEN isn't
 * set, authed flows are skipped with a note in the summary.
 */

"use strict";

const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

module.exports = [
  {
    name: "sign-in",
    description: "Phone sign-in screen (unauthenticated landing)",
    viewport: VIEWPORTS.desktop,
    auth: false,
    async run(page, { url }) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      // Wait for the auth gate to render. The gate is owned by
      // src/renderer/auth.js and shows a phone input once the page
      // boots — selecting on the input is more reliable than
      // waiting for networkidle on a CSP-heavy page.
      await page.waitForSelector('input[type="tel"], input[name="phone"]', {
        timeout: 15_000,
      });
    },
  },
  {
    name: "sign-in-mobile",
    description: "Phone sign-in screen on a mobile viewport",
    viewport: VIEWPORTS.mobile,
    auth: false,
    async run(page, { url }) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('input[type="tel"], input[name="phone"]', {
        timeout: 15_000,
      });
    },
  },
  {
    name: "welcome",
    description: "Welcome page (sidebar + home tiles) with a real session",
    viewport: VIEWPORTS.desktop,
    auth: true,
    async run(page, { url }) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      // After auth.js sees a token it removes the gate; the sidebar
      // brand mark becomes visible. Anchor the screenshot on that.
      await page.waitForSelector(".sidebar__brand", { timeout: 20_000 });
      // Give heatmap.js / seeds.js a beat to hydrate the right panel.
      await page.waitForLoadState("networkidle").catch(() => {});
    },
  },
  {
    name: "welcome-mobile",
    description: "Welcome view on a mobile viewport (drawer collapsed)",
    viewport: VIEWPORTS.mobile,
    auth: true,
    async run(page, { url }) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".drawer-toggle", { timeout: 20_000 });
      await page.waitForLoadState("networkidle").catch(() => {});
    },
  },
];
