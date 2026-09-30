/* E2E: person thread never shows outreach review UI; notes + bottom bar only. */
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { chromium, devices } = require("playwright");

const ART = "/opt/cursor/artifacts";
const iPhone = devices["iPhone 14"];
const root = path.join(__dirname, "..", "src", "renderer");

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

async function stubApis(page, state) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    let action = "";
    try { action = new URL(url).searchParams.get("action") || ""; } catch {}
    let id = "";
    try { id = new URL(url).searchParams.get("id") || ""; } catch {}
    let body = {};
    try { body = JSON.parse(route.request().postData() || "{}"); } catch { body = {}; }

    if (url.includes("/api/leads") && action === "inbox") {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          leads: [state.lead],
          drafts: state.drafts,
          companies: [state.company],
          byLeadId: {},
          profile: { name: "Tyler Lindow", title: "Founder", linkedInUrl: "", avatarUrl: "" },
        }),
      });
      return;
    }
    if (url.includes("/api/leads") && (action === "edit" || action === "lead") && method === "PATCH") {
      Object.assign(state.lead, body);
      state.noteSaves.push({ id, body });
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ lead: state.lead }),
      });
      return;
    }
    if (url.includes("/api/leads") && action === "lead") {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ lead: state.lead, drafts: state.drafts }),
      });
      return;
    }
    if (url.includes("/api/leads") && action === "drafts") {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ drafts: state.drafts }),
      });
      return;
    }
    if (url.includes("/api/leads") && action === "approve") {
      state.approveCalls.push({ id });
      await route.fulfill({
        status: 400, contentType: "application/json",
        body: JSON.stringify({ error: "approve is not available from the Tinker UI" }),
      });
      return;
    }
    if (url.includes("/api/leads") && action === "settings") {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ settings: { defaultFromAddress: "tyler@lindowlabs.dev" } }),
      });
      return;
    }
    if (url.includes("/api/schedule")) {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ byLeadId: {}, sessions: [], touches: [], busyEvents: [] }),
      });
      return;
    }
    if (url.includes("/api/self-thread")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ messages: [] }) });
      return;
    }
    if (url.includes("/api/user-data") || url.includes("/api/profile")) {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ data: { name: "Tyler Lindow", title: "Founder", linkedInUrl: "", avatarUrl: "" } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
}

describe("person thread notes-only e2e", () => {
  test("saved outreach draft never renders a review form; This is everything saves notes", async () => {
    const { server, base } = await startStaticServer();
    const browser = await chromium.launch({ headless: true });
    try {
      const state = {
        approveCalls: [],
        noteSaves: [],
        company: {
          id: "co_alloy", name: "Alloy", domain: "alloy.com", priority: 1,
          status: "active", research: "Alloy builds identity.",
        },
        lead: {
          id: "lead_andrew", personName: "Andrew Glenn", personTitle: "Vice President of Engineering",
          company: "Alloy", companyId: "co_alloy", contactType: "hiring_leader",
          email: "andrew.glenn@alloy.com", linkedInUrl: "https://www.linkedin.com/in/amg/",
          notes: "I value the same things he does",
          stage: "drafting",
        },
        drafts: [{
          id: "draft_clair",
          leadId: "lead_andrew",
          channel: "gmail_outreach",
          subject: "Building engineering culture, rigor, and good work",
          body: "giving engineers a space to do their best work",
          status: "draft",
          approvedText: "",
          approvedAt: null,
          updatedAt: "2026-09-29T22:00:00.000Z",
        }],
      };
      const context = await browser.newContext({
        ...iPhone,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      await context.addInitScript(() => {
        localStorage.setItem("tinker_jwt", "e2e_session_placeholder");
      });
      const page = await context.newPage();
      await stubApis(page, state);
      await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const gate = document.getElementById("auth-gate");
        if (gate) { gate.hidden = true; document.documentElement.classList.remove("auth-gating"); }
        const hint = document.getElementById("pwa-hint");
        if (hint) { hint.hidden = true; hint.style.display = "none"; }
      });
      await page.waitForSelector("[data-conv-id='lead_andrew']", { timeout: 20000 });
      await page.evaluate(() => window.tinkerMessagesShell.selectLead("lead_andrew"));
      await page.waitForSelector("[data-notepad-input]", { timeout: 10000 });
      await page.waitForTimeout(300);

      const ui = await page.evaluate(() => ({
        review: !!document.querySelector("[data-messages-review], .messages-review"),
        reviewTo: !!document.querySelector("[data-review-to]"),
        reviewSubject: !!document.querySelector("[data-review-subject]"),
        reviewBody: !!document.querySelector("[data-review-body]"),
        handoff: !!document.querySelector("[data-handoff-line]"),
        needsRecipient: /needs a recipient/i.test(document.body.innerText || ""),
        reviewTitle: /Review before handoff/i.test(document.body.innerText || ""),
        notes: ((document.querySelector("[data-notepad-input]") || {}).value || ""),
        keep: ((document.querySelector("[data-notepad-secondary]") || {}).textContent || ""),
        primary: ((document.querySelector("[data-notepad-primary]") || {}).textContent || ""),
      }));
      assert.equal(ui.review, false);
      assert.equal(ui.reviewTo, false);
      assert.equal(ui.reviewSubject, false);
      assert.equal(ui.reviewBody, false);
      assert.equal(ui.handoff, false);
      assert.equal(ui.needsRecipient, false);
      assert.equal(ui.reviewTitle, false);
      assert.match(ui.notes, /value the same things/i);
      assert.match(ui.keep, /Keep crafting/i);
      assert.match(ui.primary, /This is everything/i);

      await page.fill("[data-notepad-input]", "I value the same things he does\nand upholding rigor.");
      await page.click("[data-notepad-primary]");
      await page.waitForTimeout(500);
      assert.equal(state.approveCalls.length, 0);
      assert.ok(state.noteSaves.length >= 1);
      assert.match(String(state.lead.notes || ""), /upholding rigor/);

      fs.mkdirSync(ART, { recursive: true });
      await page.screenshot({ path: path.join(ART, "thread-no-review-card.png"), fullPage: false });
      await context.close();
    } finally {
      await browser.close();
      server.close();
    }
  });
});
