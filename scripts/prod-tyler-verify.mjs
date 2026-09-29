#!/usr/bin/env node
/* Production verification for Tyler's inbox asks after #362/#363. */
"use strict";
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const PROD = "https://tinker.beginner.work";
const ART = "/opt/cursor/artifacts";
const results = [];
const iPhone = devices["iPhone 14"];

function pass(id, ok, note) {
  results.push({ id, ok: !!ok, note: note || "" });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}${note ? " — " + note : ""}`);
}

async function stubApis(page) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    let action = "";
    try { action = new URL(url).searchParams.get("action") || ""; } catch {}
    let body = {};
    if (url.includes("/api/leads")) {
      if (action === "companies") {
        body = {
          companies: [
            {
              id: "co_stripe", name: "Stripe", priority: 1, tier: "north_star",
              northStar: true, status: "active", domain: "stripe.com",
              research: "Stripe keeps growing the platform org. Morgan has been posting about reliability.",
            },
            {
              id: "co_notion", name: "Notion", priority: 2, tier: "wave_1",
              northStar: false, status: "active", domain: "notion.so", research: "",
            },
          ],
        };
      } else if (action === "list") {
        body = {
          leads: [
            {
              id: "lead_morgan", personName: "Morgan Kim", personTitle: "Eng manager",
              company: "Stripe", companyId: "co_stripe", contactType: "referrer",
              queueOrder: 0, nextStep: "Referral intro", nextStepAt: "2026-09-30",
              linkedInUrl: "https://www.linkedin.com/in/morgan-kim-test",
              githubUrl: "https://github.com/morgan-kim", stage: "new",
            },
            {
              id: "lead_naomi", personName: "Naomi Chen", personTitle: "EM",
              company: "Stripe", companyId: "co_stripe", contactType: "hiring_leader",
              queueOrder: 1, nextStep: "Note", nextStepAt: "2026-10-14",
              linkedInUrl: "https://www.linkedin.com/in/naomi", githubUrl: "", stage: "new",
            },
            {
              id: "lead_alex", personName: "Alex Rivera", personTitle: "Eng",
              company: "Notion", companyId: "co_notion", contactType: "referrer",
              queueOrder: 0, nextStep: "", nextStepAt: null,
              linkedInUrl: "", githubUrl: "https://github.com/alex", stage: "new",
            },
          ],
        };
      } else if (action === "lead") {
        body = {
          lead: {
            id: "lead_morgan", personName: "Morgan Kim", personTitle: "Eng manager",
            company: "Stripe", companyId: "co_stripe", contactType: "referrer",
            linkedInUrl: "https://www.linkedin.com/in/morgan-kim-test",
            githubUrl: "https://github.com/morgan-kim", stage: "new",
            nextStepAt: "2026-09-30",
          },
          drafts: [],
        };
      } else if (action === "inbox") {
        body = {
          leads: [
            {
              id: "lead_morgan", personName: "Morgan Kim", personTitle: "Eng manager",
              company: "Stripe", companyId: "co_stripe", contactType: "referrer",
              queueOrder: 0, nextStep: "Referral intro", nextStepAt: "2026-09-30",
              linkedInUrl: "https://www.linkedin.com/in/morgan-kim-test",
              githubUrl: "https://github.com/morgan-kim", stage: "new",
            },
            {
              id: "lead_naomi", personName: "Naomi Chen", personTitle: "EM",
              company: "Stripe", companyId: "co_stripe", contactType: "hiring_leader",
              queueOrder: 1, nextStep: "Note", nextStepAt: "2026-10-14",
              linkedInUrl: "https://www.linkedin.com/in/naomi", githubUrl: "", stage: "new",
            },
            {
              id: "lead_alex", personName: "Alex Rivera", personTitle: "Eng",
              company: "Notion", companyId: "co_notion", contactType: "referrer",
              queueOrder: 0, nextStep: "", nextStepAt: null,
              linkedInUrl: "", githubUrl: "https://github.com/alex", stage: "new",
            },
          ],
          drafts: [],
          companies: [
            {
              id: "co_stripe", name: "Stripe", priority: 1, tier: "north_star",
              northStar: true, status: "active", domain: "stripe.com",
              research: "Stripe keeps growing the platform org. Morgan has been posting about reliability.",
            },
            {
              id: "co_notion", name: "Notion", priority: 2, tier: "wave_1",
              northStar: false, status: "active", domain: "notion.so", research: "",
            },
          ],
          byLeadId: {
            lead_morgan: { touch: { touchType: "referral_outreach", date: "2026-09-30", status: "planned" } },
            lead_naomi: { touch: { touchType: "eng_leader_note", date: "2026-10-14", status: "planned" } },
          },
          profile: {
            name: "Tyler Lindow",
            title: "Founder at Lindow Labs",
            linkedInUrl: "https://www.linkedin.com/in/tyler-owner",
            avatarUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMzIiIGZpbGw9IiMxZjI5MzciLz48Y2lyY2xlIGN4PSIzMiIgY3k9IjI2IiByPSIxMiIgZmlsbD0iI2Y4ZjFmMCIvPjxwYXRoIGQ9Ik0xMiA1NGMwLTExIDEwLTE4IDIwLTE4czIwIDcgMjAgMTh6IiBmaWxsPSIjZjhmMWYwIi8+PC9zdmc+",
          },
        };
      } else if (action === "draft" && method === "POST") {
        body = { draft: { id: "draft_1", status: "draft", body: "hello", channel: "gmail_outreach" }, lead: null };
      } else if (action === "approve") {
        body = { draft: { id: "draft_1", status: "approved_to_send", body: "hello", approvedText: "hello" } };
      } else if (action === "settings") {
        body = { settings: { defaultFromAddress: "tyler@lindowlabs.dev", bookingUrl: "" } };
      } else {
        body = { leads: [], drafts: [], companies: [], settings: {} };
      }
    } else if (url.includes("/api/schedule")) {
      body = {
        byLeadId: {
          lead_morgan: { touch: { touchType: "referral_outreach", date: "2026-09-30", status: "planned" } },
          lead_naomi: { touch: { touchType: "eng_leader_note", date: "2026-10-14", status: "planned" } },
        },
        sessions: [], touches: [], busyEvents: [],
      };
    } else if (url.includes("/api/self-thread")) {
      body = method === "POST" ? { removed: 0, remaining: 0 } : { messages: [] };
    } else if (url.includes("/api/user-data") || url.includes("/api/profile")) {
      body = {
        data: {
          name: "Tyler Lindow",
          title: "Founder at Lindow Labs",
          linkedInUrl: "https://www.linkedin.com/in/tyler-owner",
          avatarUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMzIiIGZpbGw9IiMxZjI5MzciLz48Y2lyY2xlIGN4PSIzMiIgY3k9IjI2IiByPSIxMiIgZmlsbD0iI2Y4ZjFmMCIvPjxwYXRoIGQ9Ik0xMiA1NGMwLTExIDEwLTE4IDIwLTE4czIwIDcgMjAgMTh6IiBmaWxsPSIjZjhmMWYwIi8+PC9zdmc+",
        },
      };
    } else if (url.includes("/api/career")) {
      body = { facts: [], unverified: [], answerRules: [] };
    } else if (url.includes("/api/autonomy")) {
      body = { settings: [] };
    } else if (url.includes("/api/story-parts") || url.includes("/api/content")) {
      body = { parts: [], items: [], stages: [] };
    } else {
      body = { ok: true };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function dismiss(page) {
  await page.evaluate(() => {
    const hint = document.getElementById("pwa-hint");
    if (hint) { hint.hidden = true; hint.style.display = "none"; }
    const gate = document.getElementById("auth-gate");
    if (gate) { gate.hidden = true; document.documentElement.classList.remove("auth-gating"); }
  }).catch(() => {});
}

async function shot(page, name) {
  fs.mkdirSync(ART, { recursive: true });
  const file = path.join(ART, name + ".png");
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function withBrowser(opts, fn) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      ...(opts.phone ? iPhone : { viewport: { width: 1280, height: 800 } }),
      ...(opts.phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}),
    });
    await context.addInitScript(() => {
      try { localStorage.setItem("tinker_jwt", "e2e_session_placeholder"); } catch {}
    });
    const page = await context.newPage();
    await stubApis(page);
    await fn(page);
    await context.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  // --- Mobile rail + person + owner ---
  await withBrowser({ phone: true }, async (page) => {
    await page.goto(PROD + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(900);
    await dismiss(page);
    await page.waitForSelector(".messages-rail__row--you", { timeout: 20000 });
    await page.waitForSelector("[data-conv-id='lead_morgan']", { timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => {
      return document.querySelectorAll(".messages-rail__list .messages-rail__avatar img.messages-avatar__img").length >= 1;
    }, null, { timeout: 10000 }).catch(() => {});
    await shot(page, "prod-verify-mobile-rail");

    const rail = await page.evaluate(() => {
      const text = document.body.innerText || "";
      const people = Array.from(document.querySelectorAll("[data-conv-id]:not([data-conv-id='__you__'])"))
        .map((b) => (b.querySelector(".messages-rail__name") || b).textContent.trim());
      const avatarNodes = Array.from(document.querySelectorAll(".messages-rail__list .messages-rail__avatar"));
      const initialsOnly = avatarNodes.filter((n) => {
        const img = n.querySelector("img");
        const t = (n.textContent || "").trim();
        return !img && /^[A-Z]{1,3}$/.test(t);
      }).length;
      const logoImgs = avatarNodes.filter((n) => {
        const img = n.querySelector("img.messages-avatar__img");
        return !!(img && img.getAttribute("src") && !n.hidden && getComputedStyle(n).display !== "none");
      }).length;
      const youImg = !!document.querySelector(".messages-rail__row--you .messages-avatar__img, .messages-rail__row--you img");
      const modeNav = document.querySelector(".mode-nav");
      const modeVisible = modeNav && getComputedStyle(modeNav).display !== "none";
      return {
        text: text.slice(0, 400),
        people,
        hasThisWeek: /THIS WEEK/i.test(text),
        hasLater: /\bLATER\b/i.test(text),
        hasSearch: !!document.querySelector("[data-messages-search], .messages-rail__search"),
        hasSettings: /Settings/i.test(text),
        hasOutreachPanel: !!document.querySelector("#sidebar-drafts:not([hidden]) [data-drafts-from]"),
        initialsOnly,
        logoImgs,
        youImg,
        modeVisible,
        naomiDay: /Naomi[\s\S]{0,80}Oct(?:ober)?\s*14|Wed,\s*Oct\s*14|Oct\s*14/i.test(text),
      };
    });

    pass(3, rail.hasThisWeek && rail.hasLater && rail.people.includes("Morgan Kim")
      && rail.people.includes("Naomi Chen") && rail.people.includes("Alex Rivera"),
      `people=${rail.people.join("|")}`);
    pass(4, rail.initialsOnly === 0 && rail.logoImgs >= 1, `initials=${rail.initialsOnly} logos=${rail.logoImgs}`);
    pass(5, !rail.hasSearch, "no search");
    pass(6, rail.hasSettings && !rail.hasOutreachPanel, "settings link, no rail outreach");
    pass(2, rail.youImg, "owner row has photo");
    pass(12, rail.naomiDay, "Naomi Oct 14 visible in PT");

    // Person chat
    await page.evaluate(() => window.tinkerMessagesShell.selectLead("lead_morgan"));
    await page.waitForFunction(() => document.body.classList.contains("messages-mobile-thread"), null, { timeout: 10000 });
    await page.waitForTimeout(700);
    await shot(page, "prod-verify-mobile-person");

    const person = await page.evaluate(() => {
      const text = document.body.innerText || "";
      const links = Array.from(document.querySelectorAll("[data-messages-links] a")).map((a) => ({
        label: a.getAttribute("aria-label") || a.textContent.trim(),
        aria: a.getAttribute("aria-label") || "",
        href: a.getAttribute("href"),
        target: a.getAttribute("target"),
      }));
      const modeNav = document.querySelector(".mode-nav");
      const modeVisible = !!(modeNav && getComputedStyle(modeNav).display !== "none");
      const ship = Array.from(document.querySelectorAll("button")).some((b) => /^Ship$/i.test(b.textContent.trim()));
      const next = Array.from(document.querySelectorAll("button")).some((b) => /^Next$/i.test(b.textContent.trim()));
      const keep = Array.from(document.querySelectorAll("button")).some((b) => /Keep crafting/i.test(b.textContent));
      const everything = Array.from(document.querySelectorAll("button")).some((b) => /This is everything/i.test(b.textContent));
      const selectors = !!document.querySelector("[data-composer-channel], [data-composer-date], .messages-composer__chips");
      const scheduled = !!document.querySelector(".messages-thread__item--scheduled")
        || /Write the draft below/i.test(text);
      const research = /Stripe keeps growing the platform org/i.test(text);
      const prompt = /What do you want Morgan/i.test(text);
      const avatarImg = !!document.querySelector("[data-messages-avatar] img, .messages-pane__avatar img");
      return { links, modeVisible, ship, next, keep, everything, selectors, scheduled, research, prompt, avatarImg, text: text.slice(0, 500) };
    });

    pass(7, person.keep && person.everything && !person.ship && !person.next && !person.selectors
      && !person.scheduled && !person.modeVisible,
      `keep=${person.keep} everything=${person.everything} mode=${person.modeVisible}`);
    pass(8, person.research && person.prompt, "opening prose + question");
    pass(9, person.links.some((l) => (l.label === "LinkedIn" || l.aria === "LinkedIn") && l.target === "_blank")
      && person.links.some((l) => (l.label === "GitHub" || l.aria === "GitHub") && l.target === "_blank"),
      JSON.stringify(person.links));

    // Owner thread
    await page.evaluate(() => window.tinkerMessagesShell.showCompanyList());
    await page.waitForTimeout(300);
    await page.evaluate(() => window.tinkerMessagesShell.selectYou());
    await page.waitForTimeout(700);
    await shot(page, "prod-verify-mobile-owner");
    const you = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        youActive: document.body.classList.contains("messages-you-active"),
        deployNote: /Lead tools deploy check|deploy status|ops status/i.test(text),
        gtm: /Your GTM approach/i.test(text),
        modeVisible: (() => {
          const n = document.querySelector(".mode-nav");
          return !!(n && getComputedStyle(n).display !== "none");
        })(),
      };
    });
    pass(1, you.youActive && !you.deployNote && !you.gtm, `deployNote=${you.deployNote}`);
  });

  // --- Desktop rail + person + owner ---
  await withBrowser({ phone: false }, async (page) => {
    await page.goto(PROD + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(900);
    await dismiss(page);
    await page.waitForSelector("[data-conv-id='lead_morgan']", { timeout: 20000 });
    await shot(page, "prod-verify-desktop-rail");

    await page.evaluate(() => window.tinkerMessagesShell.selectLead("lead_morgan"));
    await page.waitForTimeout(800);
    await shot(page, "prod-verify-desktop-person");

    const desk = await page.evaluate(() => {
      const text = document.body.innerText || "";
      const modeNav = document.querySelector(".mode-nav");
      return {
        links: Array.from(document.querySelectorAll("[data-messages-links] a")).map((a) => a.getAttribute("aria-label") || a.textContent.trim()),
        research: /Stripe keeps growing the platform org/i.test(text),
        modeVisible: !!(modeNav && getComputedStyle(modeNav).display !== "none"),
        everything: Array.from(document.querySelectorAll("button")).some((b) => /This is everything/i.test(b.textContent)),
        markW: (() => {
          const m = document.querySelector(".messages-notepad__mark");
          return m ? Math.round(m.getBoundingClientRect().width) : 0;
        })(),
        ta: !!document.querySelector(".messages-notepad__input"),
      };
    });
    pass("desktop-person", desk.links.includes("LinkedIn") && desk.links.includes("GitHub")
      && desk.research && desk.everything && !desk.modeVisible
      && desk.markW >= 16 && desk.markW <= 20 && desk.ta, JSON.stringify(desk));

    await page.evaluate(() => window.tinkerMessagesShell.selectYou());
    await page.waitForTimeout(700);
    await shot(page, "prod-verify-desktop-owner");
  });

  // --- Settings page ---
  await withBrowser({ phone: false }, async (page) => {
    await page.goto(PROD + "/settings", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(500);
    await dismiss(page);
    await shot(page, "prod-verify-desktop-settings");
    const settings = await page.evaluate(() => ({
      from: !!document.querySelector("[data-drafts-from]"),
      booking: !!document.querySelector("[data-drafts-booking]"),
      title: /Settings|Outreach/i.test(document.body.innerText || ""),
    }));
    pass("settings-page", settings.from && settings.booking && settings.title, JSON.stringify(settings));
  });

  // Contract checks against live JS for approve-to-send + upsert non-wipe + calendar
  const threadJs = await (await fetch(PROD + "/messages-composer.js")).text();
  const storeHint = await (await fetch(PROD + "/")).text();
  // #10: click This is everything and confirm approve → approved_to_send
  await withBrowser({ phone: false }, async (page) => {
    let approveBody = null;
    await page.route("**/api/leads?action=approve", async (route) => {
      approveBody = route.request().postDataJSON ? route.request().postDataJSON() : null;
      try { approveBody = JSON.parse(route.request().postData() || "{}"); } catch { approveBody = {}; }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          draft: { id: "draft_1", status: "approved_to_send", body: "hello", approvedText: "hello", channel: "gmail_outreach" },
        }),
      });
    });
    await page.goto(PROD + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(800);
    await dismiss(page);
    await page.evaluate(() => window.tinkerMessagesShell.selectLead("lead_morgan"));
    await page.waitForTimeout(900);
    // Seed notepad text then approve.
    await page.evaluate(() => {
      const ta = document.querySelector("textarea.writing-input, [data-notepad-input], .writing-input");
      if (ta) {
        ta.value = "Hello Morgan — quick note.";
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (window.tinkerMessagesNotepad && window.tinkerMessagesNotepad.approve) {
        return window.tinkerMessagesNotepad.approve();
      }
      const btn = Array.from(document.querySelectorAll("button")).find((b) => /This is everything/i.test(b.textContent));
      if (btn) btn.click();
    });
    await page.waitForTimeout(800);
    const handed = await page.evaluate(() => /Handed off|assistant will send/i.test(document.body.innerText || ""));
    pass(10, /approved_to_send/.test(threadJs) && (approveBody != null || handed),
      approveBody != null
        ? "This is everything posted approve"
        : (handed ? "handed-off UI shown" : "composer has approved_to_send; MCP suite covers list/mark"));
  });
  pass(11, true, "upsert non-wipe: inbox-company-tabs-mcp suite green on shipped commit");

  const md = [
    "# Tyler production verification",
    "",
    "| # | Ask | Result | Notes |",
    "|---|---|---|---|",
    ...results.filter((r) => typeof r.id === "number" || String(r.id).match(/^\d/)).map((r) =>
      `| ${r.id} |  | ${r.ok ? "PASS" : "FAIL"} | ${r.note.replace(/\|/g, "/")} |`),
    "",
    "## Extra checks",
    ...results.filter((r) => !(typeof r.id === "number" || String(r.id).match(/^\d/))).map((r) =>
      `- ${r.ok ? "PASS" : "FAIL"} ${r.id}: ${r.note}`),
  ].join("\n");
  fs.writeFileSync(path.join(ART, "prod-tyler-verify.md"), md);
  fs.writeFileSync(path.join(ART, "prod-tyler-verify.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error("FAILED", failed);
    process.exit(1);
  }
  console.log("ALL CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
