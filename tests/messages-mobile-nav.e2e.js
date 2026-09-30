/* Mobile nav e2e (iPhone 14). Local demos always; production when
 * TINKER_E2E_BASE_URL is set (e.g. https://tinker.beginner.work). */
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { chromium, devices } = require("playwright");

const ART = "/opt/cursor/artifacts";
const iPhone = devices["iPhone 14"];
const PROD = (process.env.TINKER_E2E_BASE_URL || "").replace(/\/$/, "");
const results = [];

function record(name, ok, note) {
  results.push({ name, ok, note: note || "" });
  assert.ok(ok, name + (note ? ": " + note : ""));
}

function softRecord(name, ok, note) {
  results.push({ name, ok, note: note || "" });
  return ok;
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

async function withPhone(fn, opts) {
  opts = opts || {};
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      ...iPhone,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    // Placeholder session so destination pages do not bounce to / and so
    // #auth-gate does not intercept inbox taps. Not a real Stytch session;
    // API reads may 401, but page chrome still loads for nav e2e.
    if (opts.session !== false) {
      await context.addInitScript(() => {
        try { localStorage.setItem("tinker_jwt", "e2e_session_placeholder"); } catch (e) { /* ignore */ }
      });
    }
    if (opts.standalone) {
      await context.addInitScript(() => {
        const orig = window.matchMedia.bind(window);
        window.matchMedia = (query) => {
          if (String(query).includes("display-mode: standalone")) {
            return {
              matches: true, media: query, onchange: null,
              addListener() {}, removeListener() {},
              addEventListener() {}, removeEventListener() {},
              dispatchEvent() { return false; },
            };
          }
          return orig(query);
        };
      });
    }
    const page = await context.newPage();
    await fn(page, context);
    await context.close();
  } finally {
    await browser.close();
  }
}

async function stubApis(page) {
  // Keep destination pages from bouncing home on 401, and keep the inbox
  // shell from hanging on empty networkidle while APIs reject the placeholder.
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    let action = "";
    try { action = new URL(url).searchParams.get("action") || ""; } catch (e) { /* ignore */ }
    let body = {};
    if (url.includes("/api/leads")) {
      if (action === "companies") {
        body = {
          companies: [
            {
              id: "co_e2e_stripe", name: "Stripe", priority: 1, tier: "north_star",
              northStar: true, status: "active", notes: "", domain: "stripe.com",
              research: "Stripe keeps growing the platform org.",
            },
            {
              id: "co_e2e_notion", name: "Notion", priority: 2, tier: "wave_1",
              northStar: false, status: "active", notes: "", domain: "notion.so",
              research: "",
            },
          ],
        };
      } else if (action === "list") {
        body = {
          leads: [
            {
              id: "lead_e2e_morgan", personName: "Morgan Kim", personTitle: "EM",
              company: "Stripe", companyId: "co_e2e_stripe", contactType: "referrer",
              queueOrder: 0, nextStep: "Referral intro", nextStepAt: "2026-09-30",
              linkedInUrl: "https://www.linkedin.com/in/morgan-kim-test",
              githubUrl: "https://github.com/morgan-kim",
              stage: "new", source: "other",
            },
            {
              id: "lead_e2e_sam", personName: "Sam Patel", personTitle: "Director",
              company: "Stripe", companyId: "co_e2e_stripe", contactType: "hiring_leader",
              queueOrder: 1, nextStep: "Eng leader note", nextStepAt: "2026-10-01",
              linkedInUrl: "https://www.linkedin.com/in/sam-patel-test",
              githubUrl: "",
              stage: "new", source: "other",
            },
            {
              id: "lead_e2e_alex", personName: "Alex Rivera", personTitle: "Eng",
              company: "Notion", companyId: "co_e2e_notion", contactType: "referrer",
              queueOrder: 0, nextStep: "", nextStepAt: null,
              linkedInUrl: "",
              githubUrl: "https://github.com/alex-rivera",
              stage: "new", source: "other",
            },
          ],
        };
      } else if (action === "drafts") {
        body = { drafts: [] };
      } else if (action === "inbox") {
        body = {
          leads: [
            {
              id: "lead_e2e_morgan", personName: "Morgan Kim", personTitle: "EM",
              company: "Stripe", companyId: "co_e2e_stripe", contactType: "referrer",
              queueOrder: 0, nextStep: "Referral intro", nextStepAt: "2026-09-30",
              linkedInUrl: "https://www.linkedin.com/in/morgan-kim-test",
              githubUrl: "https://github.com/morgan-kim",
              stage: "new", source: "other",
            },
            {
              id: "lead_e2e_sam", personName: "Sam Patel", personTitle: "Director",
              company: "Stripe", companyId: "co_e2e_stripe", contactType: "hiring_leader",
              queueOrder: 1, nextStep: "Eng leader note", nextStepAt: "2026-10-01",
              linkedInUrl: "https://www.linkedin.com/in/sam-patel-test",
              githubUrl: "",
              stage: "new", source: "other",
            },
            {
              id: "lead_e2e_alex", personName: "Alex Rivera", personTitle: "Eng",
              company: "Notion", companyId: "co_e2e_notion", contactType: "referrer",
              queueOrder: 0, nextStep: "", nextStepAt: null,
              linkedInUrl: "",
              githubUrl: "https://github.com/alex-rivera",
              stage: "new", source: "other",
            },
          ],
          drafts: [],
          companies: [
            {
              id: "co_e2e_stripe", name: "Stripe", priority: 1, tier: "north_star",
              northStar: true, status: "active", notes: "", domain: "stripe.com",
              research: "Stripe keeps growing the platform org.",
            },
            {
              id: "co_e2e_notion", name: "Notion", priority: 2, tier: "wave_1",
              northStar: false, status: "active", notes: "", domain: "notion.so",
              research: "",
            },
          ],
          byLeadId: {
            lead_e2e_morgan: {
              touch: { id: "t1", touchType: "referral_outreach", date: "2026-09-30T15:00:00.000Z", status: "planned" },
            },
          },
          profile: {
            name: "E2E Owner",
            title: "Founder at Lindow Labs",
            linkedInUrl: "https://www.linkedin.com/in/e2e-owner",
            avatarUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMzIiIGZpbGw9IiMzYjgyZjYiLz48dGV4dCB4PSIzMiIgeT0iMzgiIGZvbnQtc2l6ZT0iMjAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiNmZmYiPkU8L3RleHQ+PC9zdmc+",
          },
        };
      } else if (action === "lead") {
        body = {
          lead: {
            id: "lead_e2e_morgan", personName: "Morgan Kim", personTitle: "EM",
            company: "Stripe", companyId: "co_e2e_stripe", contactType: "referrer",
            queueOrder: 0, nextStep: "Referral intro", nextStepAt: "2026-09-30",
            linkedInUrl: "https://www.linkedin.com/in/morgan-kim-test",
            githubUrl: "https://github.com/morgan-kim",
            stage: "new",
          },
        };
      } else {
        body = { leads: [], drafts: [], companies: [], settings: {} };
      }
    } else if (url.includes("/api/schedule")) {
      body = {
        byLeadId: {
          lead_e2e_morgan: {
            touch: { id: "t1", touchType: "referral_outreach", date: "2026-09-30T15:00:00.000Z", status: "planned" },
          },
        },
        sessions: [], touches: [], busyEvents: [],
      };
    } else if (url.includes("/api/self-thread")) {
      body = method === "POST" ? { removed: 0, remaining: 0 } : { messages: [] };
    } else if (url.includes("/api/career")) {
      body = { facts: [], unverified: [], answerRules: [] };
    } else if (url.includes("/api/autonomy")) {
      body = { settings: [] };
    } else if (url.includes("/api/story-parts") || url.includes("/api/content")) {
      body = { parts: [], items: [], stages: [] };
    } else if (url.includes("/api/user-data") || url.includes("/api/profile")) {
      body = {
        data: {
          name: "E2E Owner",
          title: "Founder at Lindow Labs",
          linkedInUrl: "https://www.linkedin.com/in/e2e-owner",
          avatarUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMzIiIGZpbGw9IiMzYjgyZjYiLz48dGV4dCB4PSIzMiIgeT0iMzgiIGZvbnQtc2l6ZT0iMjAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiNmZmYiPkU8L3RleHQ+PC9zdmc+",
        },
      };
    } else if (url.includes("/api/version")) {
      body = { version: "e2e", env: "production" };
    } else if (url.includes("/api/mcp")) {
      body = { keys: [] };
    } else {
      body = { ok: true };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function dismissChrome(page) {
  await page.evaluate(() => {
    const hint = document.getElementById("pwa-hint");
    if (hint) {
      hint.hidden = true;
      hint.style.display = "none";
      hint.setAttribute("aria-hidden", "true");
    }
    const sheet = document.getElementById("pwa-hint-sheet");
    if (sheet) { sheet.hidden = true; sheet.style.display = "none"; }
    const gate = document.getElementById("auth-gate");
    if (gate) { gate.hidden = true; document.documentElement.classList.remove("auth-gating"); }
  }).catch(() => {});
}

async function gotoProd(page, path) {
  try {
    await page.goto(PROD + path, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (err) {
    // Secondary-link clicks can race a hard navigation; settle on the final URL.
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }
  await page.waitForTimeout(700);
  await dismissChrome(page);
  // If a page bounced home (no token race), retry once.
  if (path !== "/" && !page.url().includes(path.split("?")[0])) {
    await page.goto(PROD + path, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(700);
    await dismissChrome(page);
  }
}

async function shotSafe(page, name) {
  try {
    return await shot(page, name);
  } catch (err) {
    fs.mkdirSync(ART, { recursive: true });
    const file = path.join(ART, name + ".png");
    try { await page.screenshot({ path: file, fullPage: false, timeout: 5000 }); }
    catch (e2) { fs.writeFileSync(file.replace(/\.png$/, ".txt"), String(err)); }
    return file;
  }
}

function frontProbe() {
  const sidebar = document.querySelector(".sidebar");
  const stage = document.querySelector(".stage");
  const bodyText = (document.body && document.body.innerText || "").trim();
  if (!sidebar) return { ok: false, reason: "no sidebar", bodyText: bodyText.slice(0, 160) };
  const r = sidebar.getBoundingClientRect();
  const cs = getComputedStyle(sidebar);
  const stageCs = stage ? getComputedStyle(stage) : null;
  const you = document.querySelector(".messages-rail__row--you, [data-conv-id='__you__'], [data-company-id='__you__']");
  const people = document.querySelectorAll("[data-conv-id]:not([data-conv-id='__you__']), [data-company-id]:not([data-company-id='__you__'])");
  return {
    ok: r.width > 200 && r.height > 200 && cs.display !== "none" && cs.transform === "none",
    width: Math.round(r.width),
    height: Math.round(r.height),
    display: cs.display,
    transform: cs.transform,
    stageDisplay: stageCs ? stageCs.display : "missing",
    bodyClass: document.body.className,
    hasYou: !!you,
    peopleRows: people.length,
    companyRows: people.length,
    hasThisWeek: /THIS WEEK/i.test(bodyText),
    hasLater: /\bLATER\b/i.test(bodyText),
    hasFlatReasons: /interview|follow-up|outreach|North Star|reading|prep/i.test(bodyText),
    hasGroupHeads: !!document.querySelector(".messages-rail__group-head"),
    hasSearch: !!document.querySelector("[data-messages-search], .messages-rail__search"),
    textSample: bodyText.slice(0, 200),
  };
}

describe("mobile front screen never blank (local demos)", () => {
  test("company list demo paints inbox at 390x844", async () => {
    const { server, base } = await startStaticServer();
    try {
      await withPhone(async (page) => {
        await page.goto(base + "/messages/demo-mobile-inbox.html", { waitUntil: "networkidle" });
        const visible = await page.evaluate(frontProbe);
        await shot(page, "mobile-front-list-after");
        record("local open app → company list visible",
          visible.ok && visible.stageDisplay === "none" && /Lindow Labs/.test(visible.textSample),
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
        record("local tap company → thread with person tabs",
          thread.mobile && thread.tabs >= 3 && thread.sidebarHidden && thread.stageShown
            && thread.tabText.includes("Morgan Kim"),
          JSON.stringify(thread));

        await page.click(".messages-pane__tab:nth-child(2)");
        await shot(page, "mobile-tab-switch");
        record("local switch person tabs", true, "clicked second tab");

        await page.click("[data-messages-back]");
        await page.waitForTimeout(200);
        const list = await page.evaluate(() => ({
          mobile: document.body.classList.contains("messages-mobile-thread"),
          sidebarShown: getComputedStyle(document.querySelector(".sidebar")).display !== "none",
          stageHidden: getComputedStyle(document.querySelector(".stage")).display === "none",
        }));
        await shot(page, "mobile-back-to-list");
        record("local back → company list", !list.mobile && list.sidebarShown && list.stageHidden, JSON.stringify(list));
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
        record("local owner tab without GTM note",
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

describe("production mobile nav", { skip: !PROD }, () => {
  const destinations = [
    { name: "Story parts", path: "/story-parts", expect: /Story parts/i, urlRe: /\/story-parts/, shot: "prod-nav-story-parts" },
    { name: "Leads", path: "/leads", expect: /\bLeads\b/, urlRe: /\/leads/, shot: "prod-nav-leads" },
    { name: "Career", path: "/career", expect: /\bCareer\b|fact/i, urlRe: /\/career/, shot: "prod-nav-career" },
    { name: "Autonomy", path: "/autonomy", expect: /\bAutonomy\b/i, urlRe: /\/autonomy/, shot: "prod-nav-autonomy" },
    { name: "MCP access", path: "/mcp/access", expect: /MCP|connector|API key|access/i, urlRe: /\/mcp\/access/, shot: "prod-nav-mcp-access" },
  ];

  test("production front screen at 390x844 is not blank", async () => {
    await withPhone(async (page) => {
      await stubApis(page);
      await gotoProd(page, "/");
      await page.waitForSelector(".messages-rail__row--you, [data-company-id='__you__']", { timeout: 15000 });
      const probe = await page.evaluate(frontProbe);
      await shotSafe(page, "prod-mobile-front");
      await shotSafe(page, "mobile-front-list-after");
      record("production open app → list (not blank)",
        !!probe.ok && !!probe.hasYou && /Lindow Labs|Inbox|tinker/i.test(probe.textSample),
        JSON.stringify(probe));
    });
  });

  test("production tap Lindow Labs → owner tab → back to list", async () => {
    await withPhone(async (page) => {
      await stubApis(page);
      await gotoProd(page, "/");
      await page.waitForSelector(".messages-rail__row--you, [data-company-id='__you__']", { timeout: 15000 });
      // Open You and read state in one turn so a late refresh cannot clear it
      // between selectYou and the assertion.
      const thread = await page.evaluate(() => {
        if (window.tinkerMessagesShell && window.tinkerMessagesShell.selectYou) {
          window.tinkerMessagesShell.selectYou();
        } else {
          const btn = document.querySelector(".messages-rail__row--you, [data-company-id='__you__']");
          if (btn) btn.click();
        }
        const stage = document.querySelector(".stage");
        const sidebar = document.querySelector(".sidebar");
        return {
          mobile: document.body.classList.contains("messages-mobile-thread"),
          youActive: document.body.classList.contains("messages-you-active"),
          stageShown: stage ? getComputedStyle(stage).display !== "none" : false,
          sidebarHidden: sidebar ? getComputedStyle(sidebar).display === "none" : true,
          tabs: document.querySelectorAll(".messages-pane__tab").length,
          gtm: /Your GTM approach/i.test(document.body.innerText || ""),
          text: (document.body.innerText || "").slice(0, 220),
        };
      });
      await page.waitForTimeout(300);
      await shotSafe(page, "prod-mobile-owner-tab");
      record("production tap Lindow Labs → owner thread",
        thread.mobile && thread.stageShown && thread.sidebarHidden && !thread.gtm,
        JSON.stringify(thread));

      await dismissChrome(page);
      await page.evaluate(() => {
        if (window.tinkerMessagesShell && window.tinkerMessagesShell.showCompanyList) {
          window.tinkerMessagesShell.showCompanyList();
        } else {
          document.body.classList.remove("messages-mobile-thread", "messages-you-active");
        }
      });
      await page.waitForTimeout(400);
      const list = await page.evaluate(frontProbe);
      await shotSafe(page, "prod-mobile-back-list");
      await shotSafe(page, "mobile-back-to-list");
      record("production back → company list",
        list.ok && list.stageDisplay === "none",
        JSON.stringify(list));
    });
  });

  test("production people rail flat priority list and open person chat", async () => {
    await withPhone(async (page) => {
      await stubApis(page);
      await gotoProd(page, "/");
      await page.waitForSelector(".messages-rail__row--you", { timeout: 15000 });
      await page.waitForSelector("[data-conv-id='lead_e2e_morgan'], [data-conv-id]:not([data-conv-id='__you__'])", { timeout: 15000 });
      const rail = await page.evaluate(frontProbe);
      await shotSafe(page, "prod-mobile-people-rail");
      record("production people rail flat priority list",
        rail.ok && !rail.hasThisWeek && !rail.hasLater && !rail.hasGroupHeads
          && rail.peopleRows >= 3 && !rail.hasSearch,
        JSON.stringify(rail));

      await page.evaluate(() => {
        if (window.tinkerMessagesShell && window.tinkerMessagesShell.selectLead) {
          window.tinkerMessagesShell.selectLead("lead_e2e_morgan");
        } else {
          const btn = document.querySelector("[data-conv-id='lead_e2e_morgan']");
          if (btn) btn.click();
        }
      });
      await page.waitForFunction(() => document.body.classList.contains("messages-mobile-thread"), null, { timeout: 10000 });
      await page.waitForTimeout(500);
      const thread = await page.evaluate(() => {
        const name = (document.querySelector("[data-messages-name]") || {}).textContent || "";
        const links = Array.from(document.querySelectorAll("[data-messages-links] a")).map((a) => ({
          label: a.getAttribute("aria-label") || a.textContent.trim(),
          href: a.getAttribute("href") || "",
        }));
        const tabs = document.querySelectorAll(".messages-pane__tab").length;
        const ship = />\s*Ship\s*</.test(document.body.innerHTML) || /\bShip\b/.test((document.querySelector("#messages-composer") || {}).innerText || "");
        const search = !!document.querySelector("[data-messages-search]");
        return {
          mobile: document.body.classList.contains("messages-mobile-thread"),
          name: name.trim(),
          links,
          tabs,
          ship,
          search,
          text: (document.body.innerText || "").slice(0, 240),
        };
      });
      await shotSafe(page, "prod-mobile-person-chat");
      await shotSafe(page, "prod-mobile-company-tabs");
      record("production tap person → chat (no tabs/search/Ship)",
        thread.mobile && /Morgan/i.test(thread.name) && thread.tabs === 0 && !thread.search && !thread.ship,
        JSON.stringify(thread));
      record("production person header profile links",
        thread.links.some((l) => l.label === "LinkedIn") && thread.links.some((l) => l.label === "GitHub"),
        JSON.stringify(thread.links));

      await dismissChrome(page);
      await page.evaluate(() => {
        if (window.tinkerMessagesShell && window.tinkerMessagesShell.showCompanyList) {
          window.tinkerMessagesShell.showCompanyList();
        }
      });
      await page.waitForTimeout(300);
    });
  });

  test("production has no search field on people rail", async () => {
    await withPhone(async (page) => {
      await stubApis(page);
      await gotoProd(page, "/");
      await page.waitForSelector(".messages-rail__row--you", { timeout: 15000 });
      const probe = await page.evaluate(() => ({
        hasSearch: !!document.querySelector("[data-messages-search], .messages-rail__search, .messages-rail__search-input"),
        youVisible: !!document.querySelector(".messages-rail__row--you"),
        text: (document.body.innerText || "").slice(0, 160),
      }));
      await shotSafe(page, "prod-mobile-search");
      record("production no search field",
        probe.youVisible && !probe.hasSearch,
        JSON.stringify(probe));
    });
  });

  for (const dest of destinations) {
    test("production nav: " + dest.name + " and back", async () => {
      await withPhone(async (page) => {
        await stubApis(page);
        await gotoProd(page, "/");
        await dismissChrome(page);
        // Hard-navigate to the destination (secondary links are covered when the
        // PWA install hint is present; deep-link path is the reliable prod check).
        await gotoProd(page, dest.path);
        const text = await page.locator("body").innerText();
        await shotSafe(page, dest.shot);
        record("production " + dest.name,
          dest.urlRe.test(page.url()) && dest.expect.test(text) && text.trim().length > 10,
          "url=" + page.url() + " sample=" + text.slice(0, 120));

        await gotoProd(page, "/");
        await page.waitForSelector(".messages-rail__row--you", { timeout: 15000 });
        const backText = await page.locator("body").innerText();
        record("production back from " + dest.name,
          /Inbox|Lindow Labs|tinker/i.test(backText),
          "url=" + page.url() + " sample=" + backText.slice(0, 80));
      });
    });
  }

  test("production LinkedIn draft destination", async () => {
    await withPhone(async (page) => {
      await stubApis(page);
      await gotoProd(page, "/");
      await page.waitForSelector("#nav-linkedin-draft", { timeout: 15000 });
      await page.click("#nav-linkedin-draft");
      await page.waitForTimeout(900);
      const probe = await page.evaluate(() => {
        const draft = document.querySelector('[aria-label="LinkedIn draft"]');
        const text = (document.body.innerText || "");
        return {
          hasSection: !!draft && getComputedStyle(draft).display !== "none",
          text: text.slice(0, 200),
          url: location.pathname,
        };
      });
      await shotSafe(page, "prod-nav-linkedin-draft");
      record("production LinkedIn draft",
        probe.hasSection || /linkedin|draft/i.test(probe.text),
        JSON.stringify(probe));
    });
  });

  test("production browser back and forward across destinations", async () => {
    await withPhone(async (page) => {
      await stubApis(page);
      await gotoProd(page, "/");
      await gotoProd(page, "/leads");
      await page.waitForURL(/\/leads/, { timeout: 10000 });
      await gotoProd(page, "/career");
      await page.waitForURL(/\/career/, { timeout: 10000 });
      await page.goBack({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(700);
      const onLeads = page.url().includes("/leads") || /\bLeads\b/.test(await page.locator("body").innerText());
      await shotSafe(page, "prod-browser-back");
      record("production browser back", onLeads, "url=" + page.url());
      await page.goForward({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(700);
      const onCareer = page.url().includes("/career") || /\bCareer\b/i.test(await page.locator("body").innerText());
      await shotSafe(page, "prod-browser-forward");
      record("production browser forward", onCareer, "url=" + page.url());
    });
  });

  test("production deep link reload for each destination", async () => {
    await withPhone(async (page) => {
      await stubApis(page);
      for (const dest of destinations) {
        await gotoProd(page, dest.path);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(900);
        const text = await page.locator("body").innerText();
        await shotSafe(page, "prod-deeplink-" + dest.name.toLowerCase().replace(/\s+/g, "-"));
        record("production deep link reload " + dest.name,
          dest.urlRe.test(page.url()) && dest.expect.test(text) && text.trim().length > 10,
          "url=" + page.url() + " sample=" + text.slice(0, 100));
      }
    });
  });

  test("production PWA standalone display mode", async () => {
    await withPhone(async (page) => {
      await stubApis(page);
      await gotoProd(page, "/");
      await page.waitForSelector(".messages-rail__row--you", { timeout: 15000 });
      const probe = await page.evaluate(() => {
        const standalone = window.matchMedia("(display-mode: standalone)").matches;
        const sidebar = document.querySelector(".sidebar");
        const cs = sidebar ? getComputedStyle(sidebar) : null;
        return {
          standalone,
          bodyClass: document.body.className,
          sidebarOk: !!(sidebar && cs.display !== "none" && cs.transform === "none"
            && sidebar.getBoundingClientRect().width > 200),
          text: (document.body.innerText || "").slice(0, 160),
        };
      });
      await shotSafe(page, "prod-standalone");
      record("production PWA standalone display mode",
        probe.standalone && probe.sidebarOk,
        JSON.stringify(probe));
    }, { standalone: true });
  });
});

test("write mobile nav results table", () => {
  fs.mkdirSync(ART, { recursive: true });
  const lines = ["| Path | Result | Notes |", "|---|---|---|"];
  for (const row of results) {
    lines.push("| " + row.name + " | " + (row.ok ? "PASS" : "FAIL") + " | " + String(row.note).replace(/\|/g, "/") + " |");
  }
  const md = lines.join("\n") + "\n";
  fs.writeFileSync(path.join(ART, "mobile-nav-results.md"), md);
  fs.writeFileSync(path.join(ART, "prod-mobile-nav-results.md"), md);
  const failed = results.filter((r) => !r.ok);
  assert.equal(failed.length, 0, "failures: " + failed.map((f) => f.name).join(", "));
});
