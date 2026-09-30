/* E2E: person-thread Keep crafting asks a new question (no repeat) + scrolls. */
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { chromium, devices } = require("playwright");

const ART = "/opt/cursor/artifacts";
const iPhone = devices["iPhone 15"];
const root = path.join(__dirname, "..", "src", "renderer");

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
  notes: "Ramp's production engineering team owns reliability across the whole company.",
  research: "",
};
const alloy = {
  id: "cmun5x3jl000bsr01ydujq9df",
  name: "Alloy",
  domain: "alloy.com",
  priority: 1,
  status: "active",
  notes: "Alloy's Developer Experience team owns the Events API.",
  research: "",
};
const drafts = [
  {
    id: "draft_andrew_sent",
    leadId: andrew.id,
    channel: "gmail_outreach",
    subject: "Building engineering culture",
    body: "giving engineers a space",
    status: "sent_by_owner",
    sentAt: "2026-09-29T22:57:00.000Z",
    updatedAt: "2026-09-30T00:52:39.000Z",
  },
];

function startStaticServer() {
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
      resolve({ server, base: "http://127.0.0.1:" + server.address().port });
    });
  });
}

function leadById(id) {
  if (id === hamid.id) return hamid;
  if (id === andrew.id) return andrew;
  return { id: id, personName: "Someone", notes: "" };
}

async function stubApis(page, store) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    let action = "";
    try { action = new URL(url).searchParams.get("action") || ""; } catch {}
    let id = "";
    try { id = new URL(url).searchParams.get("id") || ""; } catch {}

    if (url.includes("/api/leads") && action === "inbox") {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          leads: store.leads,
          drafts: store.drafts,
          companies: store.companies,
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
      const lead = leadById(id);
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          lead: Object.assign({}, lead, { notes: store.notesById[lead.id] != null ? store.notesById[lead.id] : lead.notes }),
          drafts: store.drafts.filter((d) => d.leadId === lead.id),
        }),
      });
    }
    if (url.includes("/api/leads") && action === "drafts") {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ drafts: store.drafts }),
      });
    }
    if (url.includes("/api/leads") && action === "companies") {
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ companies: store.companies }),
      });
    }
    if (url.includes("/api/leads") && method === "PATCH" && action === "edit") {
      let body = {};
      try { body = route.request().postDataJSON() || {}; } catch {}
      const lead = leadById(id);
      if (typeof body.notes === "string") store.notesById[lead.id] = body.notes;
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          lead: Object.assign({}, lead, { notes: store.notesById[lead.id] || "" }),
        }),
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

async function boot(page, base, store) {
  await stubApis(page, store);
  await page.addInitScript(() => {
    try { localStorage.setItem("tinker_jwt", "e2e_session_placeholder"); } catch {}
    try { localStorage.setItem("ANTHROPIC_API_KEY", "sk-ant-test"); } catch {}
  });
  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(() => {
    const gate = document.getElementById("auth-gate");
    if (gate) { gate.hidden = true; document.documentElement.classList.remove("auth-gating"); }
    const hint = document.getElementById("pwa-hint");
    if (hint) { hint.hidden = true; hint.style.display = "none"; }
  });
  await page.waitForFunction(
    () => !!(window.tinkerMessagesShell && window.tinkerMessagesComposer && window.tinker),
    null,
    { timeout: 20000 }
  );
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__claudeLog = [];
    window.__claudeQueue = [
      { text: JSON.stringify({ next_question: "What are you noticing about what Ramp needs to hear from you?", done: false }) },
      { text: JSON.stringify({ next_question: "What are you figuring out about the reliability story they should understand?", done: false }) },
      { text: JSON.stringify({ next_question: "What learning here changes how you ask Hamid for a conversation?", done: false }) },
    ];
    window.tinker = window.tinker || {};
    window.tinker.callClaude = async (opts) => {
      window.__claudeLog.push(opts);
      const next = window.__claudeQueue.length
        ? window.__claudeQueue.shift()
        : { text: JSON.stringify({ next_question: "What else are you learning about what they should understand?", done: false }) };
      return next;
    };
  });
}

function rectsIntersect(a, b) {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

describe("person Keep crafting + menu no-overlap + inbox hides sent", () => {
  test("Keep crafting on person thread shows new questions; menu never overlaps; Andrew hidden", async () => {
    fs.mkdirSync(ART, { recursive: true });
    const { server, base } = await startStaticServer();
    const browser = await chromium.launch({ headless: true });
    const store = {
      leads: [hamid, andrew],
      drafts: drafts.slice(),
      companies: [ramp, alloy],
      notesById: { [hamid.id]: hamid.notes, [andrew.id]: andrew.notes },
    };
    try {
      const context = await browser.newContext({
        ...iPhone,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        timezoneId: "America/Los_Angeles",
        locale: "en-US",
      });
      const page = await context.newPage();
      await boot(page, base, store);

      // Inbox: Andrew (sent) must not appear; Hamid must.
      await page.waitForSelector("[data-messages-list]", { timeout: 15000 });
      const inbox = await page.evaluate(() => {
        const text = document.querySelector("[data-messages-list]")?.innerText || "";
        return {
          hasAndrew: /Andrew Glenn/i.test(text),
          hasHamid: /Hamid Dadkhah/i.test(text),
        };
      });
      assert.equal(inbox.hasAndrew, false, "Andrew with sent outreach must leave the inbox");
      assert.equal(inbox.hasHamid, true, "Hamid must remain in the inbox");

      // Open another person first (Hamid), then switch — menu must stay inline.
      await page.evaluate((id) => window.tinkerMessagesShell.selectLead(id), hamid.id);
      await page.waitForFunction(
        () => document.body.classList.contains("messages-mobile-thread")
          && !!document.querySelector("[data-notepad-input]"),
        null,
        { timeout: 15000 }
      );
      await page.waitForTimeout(400);

      async function assertMenuNoOverlap() {
        const geo = await page.evaluate(() => {
          const menu = document.querySelector("[data-messages-menu]");
          const float = document.getElementById("drawer-toggle");
          const title = document.querySelector(".messages-pane__title");
          const avatar = document.querySelector("[data-messages-avatar]");
          const back = document.querySelector("[data-messages-back]");
          const lead = document.querySelector("[data-messages-lead]");
          const mr = menu?.getBoundingClientRect();
          const fr = float ? getComputedStyle(float) : null;
          const tr = title?.getBoundingClientRect();
          const ar = avatar && !avatar.hidden ? avatar.getBoundingClientRect() : null;
          const br = back?.getBoundingClientRect();
          return {
            menuInLead: !!(menu && lead && lead.contains(menu)),
            menuDisplay: menu ? getComputedStyle(menu).display : "",
            floatDisplay: fr ? fr.display : "",
            floatVisibility: fr ? fr.visibility : "",
            menu: mr ? { left: mr.left, right: mr.right, top: mr.top, bottom: mr.bottom } : null,
            title: tr ? { left: tr.left, right: tr.right, top: tr.top, bottom: tr.bottom } : null,
            avatar: ar ? { left: ar.left, right: ar.right, top: ar.top, bottom: ar.bottom } : null,
            back: br ? { left: br.left, right: br.right, top: br.top, bottom: br.bottom } : null,
            loading: /Loading…|Loading\.\.\./.test(document.querySelector("[data-messages-thread]")?.innerText || ""),
            sentBubble: /Sent via/i.test(document.body.innerText || ""),
          };
        });
        assert.equal(geo.menuInLead, true, "menu must live in the lead row");
        assert.notEqual(geo.menuDisplay, "none");
        assert.ok(geo.floatDisplay === "none" || geo.floatVisibility === "hidden", "floating toggle must be hidden");
        assert.equal(geo.loading, false, "stray Loading… must not show with notepad");
        assert.equal(geo.sentBubble, false, "Sent via bubble must not render");
        assert.ok(geo.menu && geo.title, "menu and title rects required");
        assert.equal(rectsIntersect(geo.menu, geo.title), false, "menu must not intersect title");
        if (geo.avatar && geo.avatar.right > geo.avatar.left) {
          assert.equal(rectsIntersect(geo.menu, geo.avatar), false, "menu must not intersect logo");
        }
        if (geo.back && geo.back.right > geo.back.left) {
          assert.equal(rectsIntersect(geo.menu, geo.back), false, "menu must not intersect back");
        }
        return geo;
      }

      await assertMenuNoOverlap();

      // Switch to Andrew by direct select (still openable) then back to Hamid.
      await page.evaluate((id) => window.tinkerMessagesShell.selectLead(id), andrew.id);
      await page.waitForFunction(
        () => /Andrew Glenn/i.test(document.querySelector("[data-messages-name]")?.textContent || ""),
        null,
        { timeout: 10000 }
      );
      await page.waitForTimeout(300);
      await assertMenuNoOverlap();

      await page.evaluate((id) => window.tinkerMessagesShell.selectLead(id), hamid.id);
      await page.waitForFunction(
        () => /Hamid Dadkhah/i.test(document.querySelector("[data-messages-name]")?.textContent || ""),
        null,
        { timeout: 10000 }
      );
      await page.waitForTimeout(400);
      await assertMenuNoOverlap();

      const firstQ = await page.evaluate(() =>
        (document.querySelector("[data-notepad-question], .messages-notepad__question") || {}).textContent || ""
      );
      assert.match(firstQ, /Hamid Dadkhah/i);

      const questions = [firstQ];
      for (let i = 0; i < 3; i++) {
        const prev = questions[questions.length - 1];
        await page.fill("[data-notepad-input]", i === 0 ? "Take a chance" : ("Pass " + (i + 1) + " learning note"));
        await page.click("[data-notepad-secondary]");
        await page.waitForFunction((prevQ) => {
          const q = (document.querySelector("[data-notepad-question], .messages-notepad__question") || {}).textContent || "";
          return q && q !== prevQ;
        }, prev, { timeout: 15000 });
        const q = await page.evaluate(() =>
          (document.querySelector("[data-notepad-question], .messages-notepad__question") || {}).textContent || ""
        );
        assert.ok(q && !questions.includes(q), "question must be new, got: " + q + " prev: " + questions.join(" | "));
        questions.push(q);
        const inView = await page.evaluate(() => {
          const el = document.querySelector("[data-notepad-question], .messages-notepad__question");
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= (window.innerHeight || 844) + 40;
        });
        assert.equal(inView, true, "new question should be in or near the viewport");
        await page.waitForTimeout(200);
      }

      assert.equal(questions.length, 4);
      const unique = new Set(questions.map((q) => q.toLowerCase().replace(/\s+/g, " ").trim()));
      assert.equal(unique.size, questions.length, "no repeated questions");

      const shot = path.join(ART, "keep-crafting-person-e2e.png");
      await page.screenshot({ path: shot, fullPage: false });
      console.log("saved", shot, questions);

      await context.close();
    } finally {
      await browser.close();
      server.close();
    }
  });
});
