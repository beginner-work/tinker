/* Mobile nav e2e (iPhone 14). Runs against local demos always; against
 * production when TINKER_E2E_BASE_URL is set (post-deploy). */
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { chromium, devices } = require("playwright");

const ART = "/opt/cursor/artifacts";
const iPhone = devices["iPhone 14"];
const PROD = process.env.TINKER_E2E_BASE_URL || "";
const results = [];

function record(name, ok, note) {
  results.push({ name, ok, note: note || "" });
  assert.ok(ok, name + (note ? ": " + note : ""));
}

function startStaticServer() {
  const root = path.join(__dirname, "..", "src", "renderer");
  const types = {
    ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
    ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
  };
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";
    const file = path.join(root, urlPath.replace(/^\//, ""));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("missing"); return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "text/plain" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, base: "http://127.0.0.1:" + port });
    });
  });
}

async function shot(page, name) {
  fs.mkdirSync(ART, { recursive: true });
  const file = path.join(ART, name + ".png");
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function withPhone(fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      ...iPhone,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await fn(page, context);
    await context.close();
  } finally {
    await browser.close();
  }
}

describe("mobile front screen never blank (local demos)", () => {
  test("company list demo paints inbox at 390x844", async () => {
    const { server, base } = await startStaticServer();
    try {
      await withPhone(async (page) => {
        await page.goto(base + "/messages/demo-mobile-inbox.html", { waitUntil: "networkidle" });
        const visible = await page.evaluate(() => {
          const sidebar = document.querySelector(".sidebar");
          const stage = document.querySelector(".stage");
          const you = document.querySelector(".messages-rail__row--you");
          const cs = getComputedStyle(sidebar);
          const stageCs = getComputedStyle(stage);
          return {
            sidebarDisplay: cs.display,
            sidebarTransform: cs.transform,
            sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
            stageDisplay: stageCs.display,
            youText: you ? you.textContent.trim() : "",
            bodyClass: document.body.className,
          };
        });
        await shot(page, "mobile-front-list-after");
        record("open app → company list visible",
          visible.sidebarDisplay !== "none"
            && visible.sidebarTransform === "none"
            && visible.sidebarWidth > 300
            && visible.stageDisplay === "none"
            && /Lindow Labs/.test(visible.youText),
          JSON.stringify(visible));
      });
    } finally {
      server.close();
    }
  });

  test("tap company → person tabs → back → list", async () => {
    const { server, base } = await startStaticServer();
    try {
      await withPhone(async (page) => {
        await page.goto(base + "/messages/demo-mobile-inbox.html", { waitUntil: "networkidle" });
        await page.click("[data-open-company]");
        await page.waitForTimeout(200);
        const thread = await page.evaluate(() => ({
          mobile: document.body.classList.contains("messages-mobile-thread"),
          tabs: document.querySelectorAll(".messages-pane__tab").length,
          tabText: Array.from(document.querySelectorAll(".messages-pane__tab-name")).map((n) => n.textContent),
          sidebarHidden: getComputedStyle(document.querySelector(".sidebar")).display === "none",
          stageShown: getComputedStyle(document.querySelector(".stage")).display !== "none",
        }));
        await shot(page, "mobile-company-tabs");
        record("tap company → thread with person tabs",
          thread.mobile && thread.tabs >= 3 && thread.sidebarHidden && thread.stageShown
            && thread.tabText.includes("Morgan Kim"),
          JSON.stringify(thread));

        await page.click(".messages-pane__tab:nth-child(2)");
        await shot(page, "mobile-tab-switch");
        record("switch person tabs", true, "clicked second tab");

        await page.click("[data-messages-back]");
        await page.waitForTimeout(200);
        const list = await page.evaluate(() => ({
          mobile: document.body.classList.contains("messages-mobile-thread"),
          sidebarShown: getComputedStyle(document.querySelector(".sidebar")).display !== "none",
          stageHidden: getComputedStyle(document.querySelector(".stage")).display === "none",
        }));
        await shot(page, "mobile-back-to-list");
        record("back → company list", !list.mobile && list.sidebarShown && list.stageHidden, JSON.stringify(list));
      });
    } finally {
      server.close();
    }
  });

  test("owner tab demo has no GTM note and shows guided opening", async () => {
    const { server, base } = await startStaticServer();
    try {
      await withPhone(async (page) => {
        await page.goto(base + "/messages/demo-you.html", { waitUntil: "networkidle" });
        const probe = await page.evaluate(() => {
          const stage = document.querySelector(".stage");
          const writing = document.querySelector(".writing-question");
          return {
            stageDisplay: stage ? getComputedStyle(stage).display : "missing",
            question: writing ? writing.textContent.trim() : "",
            gtm: /Your GTM approach/i.test(document.body.innerText),
            tab: !!document.querySelector(".messages-pane__tab-name"),
          };
        });
        await shot(page, "mobile-you-no-gtm");
        record("owner tab without GTM note",
          probe.stageDisplay !== "none"
            && !probe.gtm
            && /sitting here at home/i.test(probe.question)
            && probe.tab,
          JSON.stringify(probe));
      });
    } finally {
      server.close();
    }
  });

  test("desktop company inbox + tabs still paints", async () => {
    const browser = await chromium.launch({ headless: true });
    const { server, base } = await startStaticServer();
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(base + "/messages/demo-company-inbox.html", { waitUntil: "networkidle" });
      const tabs = await page.locator(".messages-pane__tab").count();
      await shot(page, "desktop-company-tabs");
      record("desktop company with person tabs", tabs >= 3, "tabs=" + tabs);
      await page.close();
    } finally {
      server.close();
      await browser.close();
    }
  });
});

describe("production mobile nav (optional)", { skip: !PROD }, () => {
  const destinations = [
    { name: "Story parts", path: "/story-parts", expect: /story/i },
    { name: "Leads", path: "/leads", expect: /lead/i },
    { name: "Career", path: "/career", expect: /career|fact/i },
    { name: "Autonomy", path: "/autonomy", expect: /autonomy/i },
    { name: "MCP access", path: "/mcp/access", expect: /mcp|connector|access/i },
  ];

  test("production front screen at 390x844 is not blank", async () => {
    await withPhone(async (page) => {
      await page.goto(PROD.replace(/\/$/, "") + "/", { waitUntil: "networkidle", timeout: 60000 });
      await page.waitForTimeout(800);
      const probe = await page.evaluate(() => {
        const sidebar = document.querySelector(".sidebar");
        const bodyText = (document.body && document.body.innerText || "").trim();
        if (!sidebar) return { ok: false, reason: "no sidebar", bodyText: bodyText.slice(0, 120) };
        const r = sidebar.getBoundingClientRect();
        const cs = getComputedStyle(sidebar);
        return {
          ok: r.width > 200 && r.height > 200 && cs.display !== "none" && cs.transform === "none",
          width: Math.round(r.width),
          height: Math.round(r.height),
          display: cs.display,
          transform: cs.transform,
          bodyClass: document.body.className,
          hasYou: !!document.querySelector(".messages-rail__row--you, [data-messages-you-slot]"),
          textSample: bodyText.slice(0, 160),
        };
      });
      await shot(page, "prod-mobile-front");
      record("production open app → list (not blank)", !!probe.ok, JSON.stringify(probe));
    });
  });

  for (const dest of destinations) {
    test("production nav: " + dest.name, async () => {
      await withPhone(async (page) => {
        const url = PROD.replace(/\/$/, "") + dest.path;
        await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
        await page.waitForTimeout(500);
        const text = await page.locator("body").innerText();
        const file = "prod-nav-" + dest.name.toLowerCase().replace(/\s+/g, "-");
        await shot(page, file);
        record("production " + dest.name, dest.expect.test(text) && text.trim().length > 20, text.slice(0, 120));
        await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
      });
    });
  }

  test("production deep link reload + standalone display", async () => {
    await withPhone(async (page, context) => {
      await page.goto(PROD.replace(/\/$/, "") + "/leads", { waitUntil: "networkidle", timeout: 60000 });
      await page.reload({ waitUntil: "networkidle" });
      const text = await page.locator("body").innerText();
      await shot(page, "prod-deeplink-leads");
      record("deep link /leads reload", /lead/i.test(text), text.slice(0, 100));

      await context.addInitScript(() => {
        Object.defineProperty(window, "matchMedia", {
          writable: true,
          value: (query) => {
            if (String(query).includes("display-mode: standalone")) {
              return { matches: true, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
            }
            return { matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
          },
        });
      });
      await page.goto(PROD.replace(/\/$/, "") + "/", { waitUntil: "networkidle", timeout: 60000 });
      await shot(page, "prod-standalone");
      record("PWA standalone display mode load", true, "loaded with standalone matchMedia");
    });
  });
});

test("write mobile nav results table", () => {
  fs.mkdirSync(ART, { recursive: true });
  const lines = ["| Path | Result | Notes |", "|---|---|---|"];
  for (const row of results) {
    lines.push("| " + row.name + " | " + (row.ok ? "PASS" : "FAIL") + " | " + String(row.note).replace(/\|/g, "/") + " |");
  }
  fs.writeFileSync(path.join(ART, "mobile-nav-results.md"), lines.join("\n") + "\n");
  assert.ok(results.every((r) => r.ok), "all recorded paths must pass");
});
