/* Person notepad mark size + person→owner LinkedIn clear (Playwright). */
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");
const { chromium, devices } = require("playwright");

const ART = "/opt/cursor/artifacts";
const iPhone = devices["iPhone 14"];

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

async function stubApis(page) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    let action = "";
    try { action = new URL(url).searchParams.get("action") || ""; } catch (e) { /* ignore */ }
    let body = {};
    if (url.includes("/api/leads")) {
      if (action === "companies") {
        body = {
          companies: [{
            id: "co_alloy", name: "Alloy", priority: 1, tier: "wave_1",
            northStar: false, status: "active", domain: "alloy.com",
            research: "Alloy builds identity infrastructure.",
          }],
        };
      } else if (action === "list") {
        body = {
          leads: [{
            id: "lead_andrew", personName: "Andrew Glenn", personTitle: "Vice President of Engineering",
            company: "Alloy", companyId: "co_alloy", contactType: "hiring_leader",
            queueOrder: 0, nextStep: "eng leader note", nextStepAt: "2026-09-30",
            linkedInUrl: "https://www.linkedin.com/in/andrew-glenn-person",
            githubUrl: "https://github.com/andrew-glenn",
            stage: "new",
          }],
        };
      } else if (action === "lead") {
        body = {
          lead: {
            id: "lead_andrew", personName: "Andrew Glenn", personTitle: "Vice President of Engineering",
            company: "Alloy", companyId: "co_alloy",
            linkedInUrl: "https://www.linkedin.com/in/andrew-glenn-person",
            githubUrl: "https://github.com/andrew-glenn",
            stage: "new",
          },
          drafts: [],
        };
      } else if (action === "drafts") {
        body = { drafts: [] };
      } else if (action === "inbox") {
        body = {
          leads: [{
            id: "lead_andrew", personName: "Andrew Glenn", personTitle: "Vice President of Engineering",
            company: "Alloy", companyId: "co_alloy", contactType: "hiring_leader",
            queueOrder: 0, nextStep: "eng leader note", nextStepAt: "2026-09-30",
            linkedInUrl: "https://www.linkedin.com/in/andrew-glenn-person",
            githubUrl: "https://github.com/andrew-glenn",
            stage: "new",
          }],
          drafts: [],
          companies: [{
            id: "co_alloy", name: "Alloy", priority: 1, tier: "wave_1",
            northStar: false, status: "active", domain: "alloy.com",
            research: "Alloy builds identity infrastructure.",
          }],
          byLeadId: {
            lead_andrew: { touch: { touchType: "hiring_leader_outreach", date: "2026-09-30", status: "planned" } },
          },
          profile: {
            name: "Tyler Lindow",
            title: "Founder at Lindow Labs",
            linkedInUrl: "https://www.linkedin.com/in/tyler-owner",
            avatarUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMzIiIGZpbGw9IiMxZjI5MzciLz48L3N2Zz4=",
          },
        };
      } else if (action === "settings") {
        body = { settings: { defaultFromAddress: "", bookingUrl: "" } };
      } else {
        body = { leads: [], drafts: [], companies: [], settings: {} };
      }
    } else if (url.includes("/api/schedule")) {
      body = {
        byLeadId: {
          lead_andrew: { touch: { touchType: "hiring_leader_outreach", date: "2026-09-30", status: "planned" } },
        },
        sessions: [], touches: [], busyEvents: [],
      };
    } else if (url.includes("/api/self-thread")) {
      body = { messages: [] };
    } else if (url.includes("/api/user-data") || url.includes("/api/profile")) {
      body = {
        data: {
          name: "Tyler Lindow",
          title: "Founder at Lindow Labs",
          linkedInUrl: "https://www.linkedin.com/in/tyler-owner",
          avatarUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMzIiIGZpbGw9IiMxZjI5MzciLz48L3N2Zz4=",
        },
      };
    } else if (url.includes("/api/version")) {
      body = { version: "e2e", env: "test" };
    } else {
      body = { ok: true };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

describe("notepad mark size and owner LinkedIn switch", () => {
  test("demo mark is 16–20px and textarea is visible", async () => {
    const { server, base } = await startStaticServer();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
      await page.goto(base + "/messages/demo-people-header.html", { waitUntil: "networkidle" });
      const probe = await page.evaluate(() => {
        const mark = document.querySelector(".messages-notepad__mark");
        const img = document.querySelector(".messages-notepad__mark img, .messages-notepad__mark-img");
        const ta = document.querySelector(".messages-notepad__input");
        const mr = mark ? mark.getBoundingClientRect() : null;
        const ir = img ? img.getBoundingClientRect() : null;
        const tr = ta ? ta.getBoundingClientRect() : null;
        return {
          markW: mr ? Math.round(mr.width) : 0,
          markH: mr ? Math.round(mr.height) : 0,
          imgW: ir ? Math.round(ir.width) : 0,
          imgH: ir ? Math.round(ir.height) : 0,
          taVisible: !!(ta && tr && tr.height > 40 && getComputedStyle(ta).display !== "none"),
          attrW: img ? img.getAttribute("width") : "",
          attrH: img ? img.getAttribute("height") : "",
        };
      });
      fs.mkdirSync(ART, { recursive: true });
      await page.screenshot({ path: path.join(ART, "notepad-mark-size.png"), fullPage: false });
      assert.ok(probe.markW >= 16 && probe.markW <= 20, "mark width " + probe.markW);
      assert.ok(probe.markH >= 16 && probe.markH <= 20, "mark height " + probe.markH);
      assert.ok(probe.imgW >= 16 && probe.imgW <= 20, "img width " + probe.imgW);
      assert.ok(probe.imgH >= 16 && probe.imgH <= 20, "img height " + probe.imgH);
      assert.equal(probe.attrW, "18");
      assert.equal(probe.attrH, "18");
      assert.equal(probe.taVisible, true);
    } finally {
      await browser.close();
      server.close();
    }
  });

  test("switching from person to owner clears person LinkedIn", async () => {
    const { server, base } = await startStaticServer();
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        ...iPhone,
        viewport: { width: 1100, height: 800 },
      });
      await context.addInitScript(() => {
        try { localStorage.setItem("tinker_jwt", "e2e_session_placeholder"); } catch (e) { /* ignore */ }
      });
      const page = await context.newPage();
      await stubApis(page);
      await page.goto(base + "/", { waitUntil: "domcontentloaded" });
      await page.evaluate(() => {
        const hint = document.getElementById("pwa-hint");
        if (hint) { hint.hidden = true; hint.style.display = "none"; }
        const gate = document.getElementById("auth-gate");
        if (gate) { gate.hidden = true; document.documentElement.classList.remove("auth-gating"); }
      });
      await page.waitForSelector(".messages-rail__row--you", { state: "attached", timeout: 15000 });
      await page.waitForFunction(() => {
        return !!document.querySelector("[data-conv-id='lead_andrew']");
      }, null, { timeout: 15000 });

      await page.evaluate(() => window.tinkerMessagesShell.selectLead("lead_andrew"));
      await page.waitForFunction(() => {
        const a = document.querySelector("[data-messages-links] a[aria-label='LinkedIn']");
        return !!(a && a.getAttribute("href") && a.getAttribute("href").includes("andrew-glenn-person"));
      }, null, { timeout: 10000 });

      const personLinks = await page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-messages-links] a")).map((a) => ({
          label: a.getAttribute("aria-label"),
          href: a.getAttribute("href"),
          text: a.textContent.trim(),
        })));
      assert.ok(personLinks.some((l) => l.label === "LinkedIn" && /andrew-glenn-person/.test(l.href)));
      assert.ok(personLinks.every((l) => l.text === "" || l.text.indexOf("LinkedIn") === -1 || l.label));

      const markProbe = await page.evaluate(() => {
        const mark = document.querySelector(".messages-notepad__mark");
        const ta = document.querySelector(".messages-notepad__input, textarea.messages-notepad__input");
        const mr = mark ? mark.getBoundingClientRect() : null;
        return {
          markW: mr ? Math.round(mr.width) : 0,
          markH: mr ? Math.round(mr.height) : 0,
          taVisible: !!(ta && getComputedStyle(ta).display !== "none" && ta.getBoundingClientRect().height > 40),
          iconOnly: Array.from(document.querySelectorAll("[data-messages-links] a")).every((a) => {
            const label = a.getAttribute("aria-label") || "";
            return (label === "LinkedIn" || label === "GitHub") && !/>\s*LinkedIn\s*</.test(a.outerHTML);
          }),
        };
      });
      fs.mkdirSync(ART, { recursive: true });
      await page.screenshot({ path: path.join(ART, "person-notepad-small-mark.png"), fullPage: false });
      assert.ok(markProbe.markW >= 16 && markProbe.markW <= 20, "live mark w " + markProbe.markW);
      assert.ok(markProbe.markH >= 16 && markProbe.markH <= 20, "live mark h " + markProbe.markH);
      assert.equal(markProbe.taVisible, true);
      assert.equal(markProbe.iconOnly, true);

      await page.evaluate(() => window.tinkerMessagesShell.selectYou());
      await page.waitForTimeout(400);
      const owner = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll("[data-messages-links] a")).map((a) => ({
          label: a.getAttribute("aria-label"),
          href: a.getAttribute("href") || "",
        }));
        const role = (document.querySelector("[data-messages-role]") || {}).textContent || "";
        const youPreview = (document.querySelector(".messages-rail__row--you .messages-rail__preview") || {}).textContent || "";
        return { links, role, youPreview, youActive: document.body.classList.contains("messages-you-active") };
      });
      await page.screenshot({ path: path.join(ART, "owner-after-person-switch.png"), fullPage: false });
      assert.equal(owner.youActive, true);
      assert.ok(!owner.links.some((l) => /andrew-glenn-person/.test(l.href)), JSON.stringify(owner.links));
      assert.ok(
        owner.links.length === 0
          || owner.links.every((l) => l.label === "LinkedIn" && /tyler-owner/.test(l.href)),
        JSON.stringify(owner.links),
      );
      assert.match(owner.role + " " + owner.youPreview, /Founder at Lindow Labs/);
    } finally {
      await browser.close();
      server.close();
    }
  });
});
