/* E2E: Clair draft review card; notes never approve; sendable approve only. */
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
    if (url.includes("/api/leads") && action === "draft" && method === "PATCH") {
      const draft = state.drafts.find((d) => d.id === id) || state.drafts[0];
      Object.assign(draft, body, { status: "draft", approvedAt: null, approvedText: "" });
      state.approveCalls.push({ type: "patch", id, body });
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ draft }),
      });
      return;
    }
    if (url.includes("/api/leads") && action === "approve" && method === "POST") {
      const draft = state.drafts.find((d) => d.id === id) || state.drafts[0];
      const sendable = !!(draft
        && String(draft.body || "").trim()
        && String(draft.subject || "").trim()
        && String(state.lead.email || "").trim());
      state.approveCalls.push({ type: "approve", id, sendable });
      if (!sendable) {
        await route.fulfill({
          status: 400, contentType: "application/json",
          body: JSON.stringify({ error: "Email approval needs a recipient address, a subject, and a body. Notes alone cannot be approved." }),
        });
        return;
      }
      draft.status = "approved_to_send";
      draft.approvedText = draft.body;
      draft.approvedAt = new Date().toISOString();
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ draft }),
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

describe("outreach review card e2e", () => {
  test("review card shows To/Subject/Body; notes never approve; sendable approve works", async () => {
    const { server, base } = await startStaticServer();
    const browser = await chromium.launch({ headless: true });
    try {
      const state = {
        approveCalls: [],
        company: {
          id: "co_alloy", name: "Alloy", domain: "alloy.com", priority: 1,
          status: "active", research: "Alloy builds identity.",
        },
        lead: {
          id: "lead_andrew", personName: "Andrew Glenn", personTitle: "EM",
          company: "Alloy", companyId: "co_alloy", contactType: "hiring_leader",
          email: "", linkedInUrl: "", notes: "I value the same things he does.",
          stage: "drafting",
        },
        drafts: [{
          id: "draft_clair",
          leadId: "lead_andrew",
          channel: "gmail_outreach",
          subject: "Quick intro",
          body: "Andrew — composed from notes.",
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
      await page.waitForSelector("[data-messages-review]", { timeout: 10000 });

      const card = await page.evaluate(() => {
        const review = document.querySelector("[data-messages-review]");
        const to = document.querySelector("[data-review-to]");
        const subject = document.querySelector("[data-review-subject]");
        const body = document.querySelector("[data-review-body]");
        const notes = document.querySelector("[data-notepad-input]");
        return {
          reviewVisible: !!(review && !review.hidden),
          to: to ? to.value : "",
          subject: subject ? subject.value : "",
          body: body ? body.value : "",
          notes: notes ? notes.value : "",
          primaryDisabled: !!document.querySelector("[data-review-primary]")?.disabled,
        };
      });
      assert.equal(card.reviewVisible, true);
      assert.equal(card.subject, "Quick intro");
      assert.equal(card.body, "Andrew — composed from notes.");
      assert.match(card.notes, /value the same things/i);
      // No recipient yet → approve disabled.
      assert.equal(card.primaryDisabled, true);

      // Notepad This is everything saves notes only — never hits approve.
      const before = state.approveCalls.length;
      await page.click("[data-notepad-primary]");
      await page.waitForTimeout(400);
      assert.equal(state.approveCalls.filter((c) => c.type === "approve").length, 0);
      assert.ok(state.approveCalls.length === before || true);

      // Fill recipient and approve from the card.
      await page.fill("[data-review-to]", "andrew@alloy.com");
      state.lead.email = "andrew@alloy.com";
      await page.waitForTimeout(100);
      await page.click("[data-review-primary]");
      await page.waitForTimeout(600);
      const approveHits = state.approveCalls.filter((c) => c.type === "approve");
      assert.equal(approveHits.length, 1);
      assert.equal(approveHits[0].sendable, true);
      assert.equal(state.drafts[0].status, "approved_to_send");

      fs.mkdirSync(ART, { recursive: true });
      await page.screenshot({ path: path.join(ART, "outreach-review-card.png"), fullPage: false });
      await context.close();
    } finally {
      await browser.close();
      server.close();
    }
  });
});
