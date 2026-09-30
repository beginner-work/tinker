#!/usr/bin/env node
/* Prod verify: hamburger inline in header lead row + sent time in PT.
 * Waits for TARGET_SHA, then saves header-menu-inline.png at iPhone width
 * with timezoneId America/Los_Angeles.
 */
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const PROD = (process.env.TINKER_E2E_BASE_URL || "https://tinker.beginner.work").replace(/\/$/, "");
const ART = "/opt/cursor/artifacts";
const TARGET = (process.env.TARGET_SHA || "").slice(0, 7);
const iPhone = devices["iPhone 14"];

const lead = {
  id: "lead_andrew",
  personName: "Andrew Glenn",
  personTitle: "Vice President of Engineering",
  company: "Alloy",
  companyId: "co_alloy",
  contactType: "hiring_leader",
  email: "andrew.glenn@alloy.com",
  linkedInUrl: "https://www.linkedin.com/in/amg/",
  githubUrl: "https://github.com/amg",
  notes: "I value the same things he does",
  stage: "contacted",
};
const company = {
  id: "co_alloy", name: "Alloy", domain: "alloy.com", priority: 1,
  status: "active",
  notes: "Alloy's Developer Experience team owns the Events API.",
  research: "",
};
const drafts = [{
  id: "draft_clair",
  leadId: "lead_andrew",
  channel: "gmail_outreach",
  subject: "Building engineering culture, rigor, and good work",
  body: "giving engineers a space to do their best work",
  status: "sent_by_owner",
  approvedText: "",
  approvedAt: null,
  sentAt: "2026-09-29T22:57:00.000Z",
  updatedAt: "2026-09-30T00:52:39.000Z",
}];

async function waitForVersion(maxMs = 12 * 60 * 1000) {
  if (!TARGET) throw new Error("TARGET_SHA required");
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const json = await (await fetch(PROD + "/api/version")).json();
    const sha = String(json.sha || json.version || "");
    console.log("version", sha.slice(0, 12), "want", TARGET);
    if (sha.startsWith(TARGET) || sha.includes(TARGET)) return json;
    await new Promise((r) => setTimeout(r, 12000));
  }
  throw new Error("prod did not flip to " + TARGET);
}

async function stubApis(page) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/version")) return route.continue();
    let action = "";
    try { action = new URL(url).searchParams.get("action") || ""; } catch {}
    if (url.includes("/api/leads") && action === "inbox") {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          leads: [lead],
          drafts,
          companies: [company],
          byLeadId: {},
          profile: {
            name: "Tyler Lindow",
            title: "Engineering Leader & Learning Scientist",
            linkedInUrl: "https://www.linkedin.com/in/tyler-lindow",
            avatarUrl: "",
          },
        }),
      });
    }
    if (url.includes("/api/leads") && action === "lead") {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ lead, drafts }),
      });
    }
    if (url.includes("/api/leads") && action === "drafts") {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ drafts }),
      });
    }
    if (url.includes("/api/leads") && action === "companies") {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ companies: [company] }),
      });
    }
    if (url.includes("/api/leads") && action === "settings") {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ settings: { defaultFromAddress: "" } }),
      });
    }
    if (url.includes("/api/self-thread")) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ messages: [], removed: 0 }),
      });
    }
    if (url.includes("/api/schedule")) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ byLeadId: {}, sessions: [], touches: [], busyEvents: [] }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
}

async function boot(page) {
  await page.goto(PROD + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const gate = document.getElementById("auth-gate");
    if (gate) { gate.hidden = true; document.documentElement.classList.remove("auth-gating"); }
    const hint = document.getElementById("pwa-hint");
    if (hint) { hint.hidden = true; hint.style.display = "none"; }
  });
  await page.waitForFunction(
    () => !!(window.tinkerMessagesShell && window.tinkerMessagesComposer),
    null,
    { timeout: 30000 }
  );
  await page.waitForTimeout(600);
}

async function main() {
  const version = await waitForVersion();
  console.log("prod flipped", version);
  fs.mkdirSync(ART, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...iPhone,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
  });
  await context.addInitScript(() => {
    try { localStorage.setItem("tinker_jwt", "e2e_session_placeholder"); } catch {}
  });
  const page = await context.newPage();
  await stubApis(page);
  await boot(page);

  await page.evaluate(() => window.tinkerMessagesShell.selectLead("lead_andrew"));
  await page.waitForSelector("[data-notepad-input]", { timeout: 15000 });
  await page.waitForTimeout(700);

  const ui = await page.evaluate(() => {
    const menu = document.getElementById("drawer-toggle");
    const lead = document.querySelector("[data-messages-lead]");
    const back = document.querySelector("[data-messages-back]");
    const top = document.querySelector(".messages-pane__top");
    const bubble = document.querySelector(".messages-thread__item--sent .messages-thread__body");
    const meta = document.querySelector(".messages-thread__item--sent .messages-thread__meta");
    const mb = menu ? menu.getBoundingClientRect() : null;
    const lb = lead ? lead.getBoundingClientRect() : null;
    const bb = back ? back.getBoundingClientRect() : null;
    const tb = top ? top.getBoundingClientRect() : null;
    const cs = menu ? getComputedStyle(menu) : null;
    return {
      inLead: !!(menu && lead && lead.contains(menu)),
      inHeaderClass: !!(menu && menu.classList.contains("drawer-toggle--in-header")),
      position: cs ? cs.position : "",
      menuTop: mb ? mb.top : null,
      menuBottom: mb ? mb.bottom : null,
      leadTop: lb ? lb.top : null,
      leadBottom: lb ? lb.bottom : null,
      backTop: bb ? bb.top : null,
      backBottom: bb ? bb.bottom : null,
      topBottom: tb ? tb.bottom : null,
      centeredWithBack: !!(mb && bb && Math.abs((mb.top + mb.bottom) / 2 - (bb.top + bb.bottom) / 2) < 8),
      belowDivider: !!(mb && tb && mb.top >= tb.bottom - 2),
      bubbleText: bubble ? bubble.textContent : "",
      metaText: meta ? meta.textContent : "",
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  });
  console.log("ui", ui);

  if (!ui.inLead) throw new Error("hamburger not inside lead row");
  if (!ui.inHeaderClass) throw new Error("missing drawer-toggle--in-header");
  if (ui.position !== "relative") throw new Error("hamburger not position:relative: " + ui.position);
  if (ui.belowDivider) throw new Error("hamburger still below header divider");
  if (!ui.centeredWithBack) throw new Error("hamburger not vertically centered with back");
  if (ui.tz !== "America/Los_Angeles") throw new Error("browser tz not PT: " + ui.tz);
  const sentBlob = (ui.bubbleText || "") + " " + (ui.metaText || "");
  if (!/3:57\s*PM/i.test(sentBlob)) throw new Error("expected PT 3:57 PM in sent bubble, got: " + sentBlob);
  if (/10:57/.test(sentBlob)) throw new Error("UTC 10:57 still showing: " + sentBlob);

  const shot = path.join(ART, "header-menu-inline.png");
  await page.screenshot({ path: shot, fullPage: false });
  console.log("saved", shot);

  await browser.close();
  console.log("OK header-menu-inline on", version.sha || version.version);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
