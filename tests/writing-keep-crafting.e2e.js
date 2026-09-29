/* E2E: Keep crafting always shows next question or a clear retry. */
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

async function bootYou(page, base, responses) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    let action = "";
    try { action = new URL(url).searchParams.get("action") || ""; } catch {}
    if (url.includes("/api/leads") && action === "inbox") {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({
          leads: [], drafts: [], companies: [], byLeadId: {},
          profile: { name: "Tyler Lindow", title: "Founder", linkedInUrl: "", avatarUrl: "" },
        }),
      });
      return;
    }
    if (url.includes("/api/self-thread")) {
      await route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ messages: [], removed: 0 }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.addInitScript(() => {
    try { localStorage.setItem("tinker_jwt", "e2e_session_placeholder"); } catch {}
    try { localStorage.setItem("ANTHROPIC_API_KEY", "sk-ant-test"); } catch {}
    try { localStorage.removeItem("tinker.drafts.v1"); } catch {}
  });

  await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(() => {
    const gate = document.getElementById("auth-gate");
    if (gate) { gate.hidden = true; document.documentElement.classList.remove("auth-gating"); }
    const hint = document.getElementById("pwa-hint");
    if (hint) { hint.hidden = true; hint.style.display = "none"; }
  });
  await page.waitForFunction(
    () => !!(window.tinkerMessagesShell && window.tinkerMessagesYou && window.tinkerNewSession && window.tinker),
    null,
    { timeout: 20000 }
  );
  // Wait for the initial inbox refresh to settle so paintSelection cannot
  // immediately close the You thread we are about to open.
  await page.waitForTimeout(700);
  await page.evaluate((queued) => {
    window.__claudeLog = [];
    window.__claudeQueue = queued.slice();
    window.tinker = window.tinker || {};
    window.tinkerOnWritingPublish = function () { /* no-op for e2e */ };
    window.tinker.callClaude = async (opts) => {
      window.__claudeLog.push(opts);
      const next = window.__claudeQueue.length
        ? window.__claudeQueue.shift()
        : { text: JSON.stringify({ next_question: "What else feels true about this?", done: false }) };
      if (next && next.throwMessage) throw new Error(next.throwMessage);
      return next;
    };
    window.tinkerMessagesShell.selectYou();
  }, responses);
  await page.waitForFunction(() => document.body.classList.contains("messages-you-active"), null, { timeout: 10000 });
  await page.waitForTimeout(400);

  // Skip scene-setting if present, then wait for the interview question.
  await page.evaluate(() => {
    const skip = document.querySelector(".writing-seed__skip");
    if (skip) skip.click();
  });
  await page.waitForFunction(() => {
    const q = document.querySelector(".writing-question");
    if (!q) return false;
    const text = (q.textContent || "").trim();
    return /learning/i.test(text);
  }, null, { timeout: 15000 });
  await page.waitForTimeout(200);
}

describe("Keep crafting You interview", () => {
  test("empty next_question shows retry; Keep crafting retries to a real question", async () => {
    const { server, base } = await startStaticServer();
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        ...iPhone,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      await bootYou(page, base, [
        { text: JSON.stringify({ next_question: null, done: true, stitched_body: "premature", stitched_title: "Nope" }) },
        { text: JSON.stringify({ next_question: "What quiet part are you protecting?", done: false }) },
      ]);

      // Answer seed question.
      await page.fill(".writing-input", "Quiet software compounds when I stay close to the work.");
      await page.evaluate(() => document.getElementById("writing-next").click());
      await page.waitForSelector(".writing-card--error, .writing-question", { timeout: 10000 });

      const mid = await page.evaluate(() => ({
        error: !!document.querySelector(".writing-card--error"),
        heading: (document.querySelector(".writing-question") || {}).textContent || "",
        keep: (document.getElementById("writing-next") || {}).textContent || "",
        premature: /Quiet software compounds|premature|Nope/i.test(document.body.innerText || ""),
      }));
      assert.equal(mid.error, true);
      assert.match(mid.heading, /Couldn't get the next question/i);
      assert.match(mid.keep, /Keep crafting/i);
      assert.equal(mid.premature, false);

      await page.evaluate(() => document.getElementById("writing-next").click());
      await page.waitForFunction(() => {
        const q = (document.querySelector(".writing-question") || {}).textContent || "";
        return /quiet part/i.test(q);
      }, null, { timeout: 10000 });

      const after = await page.evaluate(() => ({
        question: (document.querySelector(".writing-question") || {}).textContent || "",
        error: !!document.querySelector(".writing-card--error"),
        keep: (document.getElementById("writing-next") || {}).textContent || "",
      }));
      assert.match(after.question, /quiet part/i);
      assert.equal(after.error, false);
      assert.match(after.keep, /Keep crafting/i);

      fs.mkdirSync(ART, { recursive: true });
      await page.screenshot({ path: path.join(ART, "keep-crafting-e2e.png"), fullPage: false });
      await context.close();
    } finally {
      await browser.close();
      server.close();
    }
  });

  test("empty answer Keep crafting nudges instead of no-op", async () => {
    const { server, base } = await startStaticServer();
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        ...iPhone,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      await bootYou(page, base, [
        { text: JSON.stringify({ next_question: "Unused", done: false }) },
      ]);

      const before = await page.evaluate(() =>
        (document.querySelector(".writing-question") || {}).textContent || "");
      await page.evaluate(() => document.getElementById("writing-next").click());
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => ({
        question: (document.querySelector(".writing-question") || {}).textContent || "",
        nudge: (document.querySelector("[data-keep-crafting-nudge]") || {}).textContent || "",
        needs: !!document.querySelector(".writing-input--needs-answer"),
        claude: (window.__claudeLog || []).length,
      }));
      assert.equal(after.question, before);
      assert.match(after.nudge, /Type an answer first/i);
      assert.equal(after.needs, true);
      assert.equal(after.claude, 0);
      await context.close();
    } finally {
      await browser.close();
      server.close();
    }
  });
});
