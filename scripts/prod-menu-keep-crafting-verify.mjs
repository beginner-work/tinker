#!/usr/bin/env node
/* Prod verify after menu / Keep crafting / sent-inbox fix.
 * WebKit + iPhone 15 + America/Los_Angeles.
 * Artifacts: menu-no-overlap-hamid.png, inbox-without-sent.png,
 * keep-crafting-person-3x.png
 *
 * Uses real lead ids/names from the owner account. Leads API is stubbed
 * for the browser session; final Hamid notes are written through the
 * tinker MCP upsert path by the agent after this script prints NOTES_JSON.
 */
import { webkit, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const PROD = (process.env.TINKER_E2E_BASE_URL || "https://tinker.beginner.work").replace(/\/$/, "");
const ART = "/opt/cursor/artifacts";
const TARGET = (process.env.TARGET_SHA || "").slice(0, 7);
const iPhone = devices["iPhone 15"];

const hamid = {
  id: "cmun6g1tr000711be2llfsrjo",
  personName: "Hamid Dadkhah",
  personTitle: "Head of Engineering",
  company: "Ramp",
  companyId: "cmun5x3i30008sr01xdf8uns7",
  contactType: "hiring_leader",
  linkedInUrl: "https://www.linkedin.com/in/hdadkhah/",
  githubUrl: "https://github.com/hdadkhah",
  notes: "Take a chance",
  stage: "new",
  nextStep: "Ask him whether the Production Engineering role is open to outside candidates before you apply",
  nextStepAt: "2026-09-30T16:00:00.000Z",
};
const faria = {
  id: "cmun6gqfw0009rekct3yx4bfj",
  personName: "Faria Chaudhry",
  personTitle: "Senior Technical Recruiter II",
  company: "Alloy",
  companyId: "cmun5x3jl000bsr01ydujq9df",
  contactType: "recruiter",
  linkedInUrl: "https://www.linkedin.com/in/fariachaudhry/",
  notes: "Not sure",
  stage: "new",
};
const andrew = {
  id: "cmun6g1tr000611becy0xinmn",
  personName: "Andrew Glenn",
  personTitle: "Vice President of Engineering",
  company: "Alloy",
  companyId: "cmun5x3jl000bsr01ydujq9df",
  contactType: "hiring_leader",
  linkedInUrl: "https://www.linkedin.com/in/amg/",
  githubUrl: "https://github.com/amg",
  email: "andrew.glenn@alloy.com",
  notes: "",
  stage: "contacted",
};
const ramp = {
  id: "cmun5x3i30008sr01xdf8uns7",
  name: "Ramp",
  domain: "ramp.com",
  priority: 3,
  status: "active",
  notes: "Ramp's production engineering team owns reliability across the whole company, which is the work you did bringing a missed 99.9% availability target back and catching merchant outages in under five minutes. It's a hands-on tech lead seat, and word is Ramp rarely hires managers from outside. So the first move is a conversation to see if there's a real path in.",
  research: "",
};
const alloy = {
  id: "cmun5x3jl000bsr01ydujq9df",
  name: "Alloy",
  domain: "alloy.com",
  priority: 1,
  status: "active",
  notes: "Alloy's Developer Experience team owns the Events API, the webhooks and the partner feeds, the same surface you spent years making dependable at Affirm.",
  research: "",
};
const drafts = [{
  id: "draft_andrew_sent",
  leadId: andrew.id,
  channel: "gmail_outreach",
  subject: "Building engineering culture, rigor, and good work",
  body: "giving engineers a space to do their best work",
  status: "sent_by_owner",
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

function leadById(id, notesById) {
  const base = id === hamid.id ? hamid : id === andrew.id ? andrew : id === faria.id ? faria : { id, personName: "Someone", notes: "" };
  return Object.assign({}, base, { notes: notesById[id] != null ? notesById[id] : base.notes });
}

async function main() {
  const version = await waitForVersion();
  console.log("prod flipped", version);
  fs.mkdirSync(ART, { recursive: true });

  const notesById = {
    [hamid.id]: "Take a chance",
    [andrew.id]: "",
    [faria.id]: "Not sure",
  };
  const savedPatches = [];

  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({
    ...iPhone,
    viewport: { width: 393, height: 852 },
    isMobile: true,
    hasTouch: true,
    timezoneId: "America/Los_Angeles",
    locale: "en-US",
  });
  await context.addInitScript(() => {
    try { localStorage.setItem("tinker_jwt", "e2e_session_placeholder"); } catch {}
    try { localStorage.setItem("ANTHROPIC_API_KEY", "sk-ant-test"); } catch {}
    // Kill SW so Playwright routes see every /api call (no real 401 → sign-out).
    try {
      navigator.serviceWorker && navigator.serviceWorker.getRegistrations &&
        navigator.serviceWorker.getRegistrations().then(function (regs) {
          regs.forEach(function (r) { r.unregister(); });
        });
    } catch (e) { /* ignore */ }
    // Install before platform-mobile.js so it does not proxy Claude to /api/claude/converse.
    window.__claudeLog = [];
    window.__claudeQueue = [
      { text: JSON.stringify({ next_question: "What are you noticing about the reliability story Ramp needs to hear from you?", done: false }) },
      { text: JSON.stringify({ next_question: "What are you figuring out about asking Hamid for a real path in before you apply?", done: false }) },
      { text: JSON.stringify({ next_question: "What learning here changes how you describe the outages you used to catch in under five minutes?", done: false }) },
    ];
    window.tinker = {
      version: () => Promise.resolve("0.1.0-e2e"),
      platform: () => Promise.resolve("web"),
      setIcon: () => Promise.resolve(true),
      openExternal: (url) => { window.open(url, "_blank"); return Promise.resolve(); },
      supportsWebview: false,
      setSetting: (k, v) => { try { localStorage.setItem(k, v); } catch {} return Promise.resolve(true); },
      getSetting: (k) => Promise.resolve((() => { try { return localStorage.getItem(k) || ""; } catch { return ""; } })()),
      callClaude: async () => {
        const next = window.__claudeQueue.length
          ? window.__claudeQueue.shift()
          : { text: JSON.stringify({ next_question: "What else are you learning about what they should understand?", done: false }) };
        window.__claudeLog.push(next);
        return next;
      },
    };
  });
  const page = await context.newPage();

  // Fulfill every API call — never let a real 401 clear the session.
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    let action = "";
    let id = "";
    try {
      const u = new URL(url);
      action = u.searchParams.get("action") || "";
      id = u.searchParams.get("id") || "";
    } catch {}
    if (url.includes("/api/version")) return route.continue();
    if (url.includes("/api/leads") && (action === "inbox" || action === "list")) {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          leads: [hamid, andrew, faria].map((row) => leadById(row.id, notesById)),
          drafts,
          companies: [ramp, alloy],
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
      const lead = leadById(id, notesById);
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          lead,
          drafts: drafts.filter((d) => d.leadId === lead.id),
        }),
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
        body: JSON.stringify({ companies: [ramp, alloy] }),
      });
    }
    if (url.includes("/api/leads") && method === "PATCH" && action === "edit") {
      let body = {};
      try { body = route.request().postDataJSON() || {}; } catch {}
      if (typeof body.notes === "string") {
        notesById[id] = body.notes;
        savedPatches.push({ id, notes: body.notes });
      }
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ lead: leadById(id, notesById) }),
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
    // Catch-all: never 401.
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto(PROD + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    } catch (e) { /* ignore */ }
    try { localStorage.setItem("tinker_jwt", "e2e_session_placeholder"); } catch {}
    const gate = document.getElementById("auth-gate");
    if (gate) { gate.hidden = true; document.documentElement.classList.remove("auth-gating"); }
    const hint = document.getElementById("pwa-hint");
    if (hint) { hint.hidden = true; hint.style.display = "none"; }
  });
  await page.waitForTimeout(800);
  await page.waitForFunction(
    () => !!(window.tinkerMessagesShell && window.tinkerMessagesComposer && window.tinker && typeof window.tinker.callClaude === "function"),
    null,
    { timeout: 30000 }
  );
  // Wait until inbox paint includes Hamid (and excludes Andrew).
  await page.waitForFunction(() => {
    const text = document.querySelector("[data-messages-list]")?.innerText || "";
    return /Hamid Dadkhah/i.test(text) && !/Andrew Glenn/i.test(text);
  }, null, { timeout: 20000 });
  await page.waitForTimeout(400);

  // --- Inbox without Andrew ---
  const inbox = await page.evaluate(() => {
    const text = document.querySelector("[data-messages-list]")?.innerText || "";
    return {
      hasAndrew: /Andrew Glenn/i.test(text),
      hasHamid: /Hamid Dadkhah/i.test(text),
      hasFaria: /Faria/i.test(text),
    };
  });
  console.log("inbox", inbox);
  if (inbox.hasAndrew) throw new Error("Andrew still in inbox after sent");
  if (!inbox.hasHamid) throw new Error("Hamid missing from inbox");
  await page.screenshot({ path: path.join(ART, "inbox-without-sent.png"), fullPage: false });
  console.log("saved inbox-without-sent.png");

  // --- Navigate Faria → Hamid (person switch) after list is warm ---
  async function openPerson(lead) {
    await page.evaluate((row) => {
      try { localStorage.setItem("tinker_jwt", "e2e_session_placeholder"); } catch {}
      document.body.classList.add("messages-shell-open", "messages-inbox-primary");
      window.tinkerMessagesShell.selectLead(row.id);
      // Ensure composer hydrates even if the select event raced a refresh.
      if (window.tinkerMessagesComposer && typeof window.tinkerMessagesComposer.setLead === "function") {
        window.tinkerMessagesComposer.setLead(row.id, row, null);
      }
    }, lead);
    await page.waitForFunction((name) => {
      const title = document.querySelector("[data-messages-name]")?.textContent || "";
      const q = document.querySelector("[data-notepad-question], .messages-notepad__question")?.textContent || "";
      return document.body.classList.contains("messages-mobile-thread")
        && !!document.querySelector("[data-notepad-input]")
        && (new RegExp(name, "i").test(title) || new RegExp(name, "i").test(q));
    }, lead.personName.split(" ")[0], { timeout: 15000 });
    await page.waitForTimeout(300);
  }

  await openPerson(faria);
  await openPerson(hamid);
  // Re-assert Hamid question after the switch (not a leftover Faria mount).
  await page.evaluate((row) => {
    window.tinkerMessagesComposer.setLead(row.id, row, null);
  }, hamid);
  await page.waitForFunction(
    () => /Hamid Dadkhah/i.test(document.querySelector("[data-notepad-question], .messages-notepad__question")?.textContent || ""),
    null,
    { timeout: 10000 }
  );
  await page.waitForTimeout(400);

  const menuUi = await page.evaluate(() => {
    const menu = document.querySelector("[data-messages-menu]");
    const float = document.getElementById("drawer-toggle");
    const title = document.querySelector(".messages-pane__title");
    const avatar = document.querySelector("[data-messages-avatar]");
    const back = document.querySelector("[data-messages-back]");
    const lead = document.querySelector("[data-messages-lead]");
    const mr = menu?.getBoundingClientRect();
    const tr = title?.getBoundingClientRect();
    const ar = avatar && !avatar.hidden ? avatar.getBoundingClientRect() : null;
    const br = back?.getBoundingClientRect();
    const fr = float ? getComputedStyle(float) : null;
    function hit(a, b) {
      if (!a || !b) return false;
      return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    }
    return {
      menuInLead: !!(menu && lead && lead.contains(menu)),
      menuDisplay: menu ? getComputedStyle(menu).display : "",
      floatDisplay: fr?.display,
      floatVisibility: fr?.visibility,
      hitTitle: hit(mr, tr),
      hitAvatar: ar ? hit(mr, ar) : false,
      hitBack: br ? hit(mr, br) : false,
      backVisible: !!(br && br.width > 0 && getComputedStyle(back).display !== "none"),
      loading: /Loading…|Loading\.\.\./.test(document.querySelector("[data-messages-thread]")?.innerText || ""),
      sentBubble: /Sent via/i.test(document.body.innerText || ""),
      question: (document.querySelector("[data-notepad-question], .messages-notepad__question") || {}).textContent || "",
    };
  });
  console.log("menuUi", menuUi);
  if (!menuUi.menuInLead) throw new Error("menu not in lead");
  if (menuUi.floatDisplay !== "none" && menuUi.floatVisibility !== "hidden") {
    throw new Error("floating toggle still visible");
  }
  if (menuUi.hitTitle || menuUi.hitAvatar || menuUi.hitBack) throw new Error("menu overlaps header chrome");
  if (!menuUi.backVisible) throw new Error("back arrow not visible");
  if (menuUi.loading) throw new Error("stray Loading…");
  if (menuUi.sentBubble) throw new Error("Sent via still showing");
  await page.screenshot({ path: path.join(ART, "menu-no-overlap-hamid.png"), fullPage: false });
  console.log("saved menu-no-overlap-hamid.png");

  // --- Keep crafting ×3 on Hamid ---
  const questions = [menuUi.question];
  const answers = [
    "Take a chance",
    "Reliability is the whole job — catching outages fast is how you earn the seat.",
    "I want him to see I already do the production engineering work they need.",
  ];
  for (let i = 0; i < 3; i++) {
    const prev = questions[questions.length - 1];
    await page.fill("[data-notepad-input]", answers[i]);
    await page.click("[data-notepad-secondary]");
    await page.waitForFunction((prevQ) => {
      const q = (document.querySelector("[data-notepad-question], .messages-notepad__question") || {}).textContent || "";
      return q && q !== prevQ;
    }, prev, { timeout: 20000 });
    const q = await page.evaluate(() =>
      (document.querySelector("[data-notepad-question], .messages-notepad__question") || {}).textContent || ""
    );
    if (!q || questions.includes(q)) throw new Error("repeat or empty question: " + q);
    questions.push(q);
    await page.waitForTimeout(250);
  }
  console.log("questions", questions);
  await page.screenshot({ path: path.join(ART, "keep-crafting-person-3x.png"), fullPage: false });
  console.log("saved keep-crafting-person-3x.png");

  const finalNotes = notesById[hamid.id] || "";
  console.log("NOTES_JSON", JSON.stringify({
    personId: hamid.id,
    personName: hamid.personName,
    companyName: "Ramp",
    notes: finalNotes,
    questions,
    patches: savedPatches.length,
  }));

  await browser.close();
  console.log("OK prod verify on", version.sha || version.version);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
