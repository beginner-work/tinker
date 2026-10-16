/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: "tests/visual",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: {
    toHaveScreenshot: {
      // Allow tiny antialiasing / font hinting drift across CI runners.
      maxDiffPixelRatio: 0.02,
      animations: "disabled",
      caret: "hide",
    },
  },
  use: {
    baseURL: process.env.VISUAL_BASE_URL || "http://127.0.0.1:4173",
    trace: "off",
    colorScheme: "light",
    reducedMotion: "reduce",
  },
  webServer: {
    command: "node scripts/visual-static-server.mjs",
    url: "http://127.0.0.1:4173/repo/harness/essay-question-overlap.html",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: "desktop-1440",
      use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
    {
      name: "iphone-390",
      use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 },
    },
  ],
};

module.exports = config;
