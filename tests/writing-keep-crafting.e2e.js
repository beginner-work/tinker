/* E2E: Keep crafting always shows a next question (done/empty → retry/fallback). */
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
  test("model returns done on keep_crafting, then a question is still shown", async () => {
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
        // First Keep crafting: model prematurely stitches → retry → question.
        { text: JSON.stringify({ next_question: null, done: true, stitched_body: "premature", stitched_title: "Nope" }) },
        { text: JSON.stringify({ next_question: "What quiet part are you protecting?", done: false }) },
      ]);

      const before = await page.evaluate(() =>
        (document.querySelector(".writing-question") || {}).textContent || "");

      await page.fill(".writing-input", "Quiet software compounds when I stay close to the work.");
      await page.evaluate(() => document.getElementById("writing-next").click());
      await page.waitForFunction(() => {
        const q = (document.querySelector(".writing-question") || {}).textContent || "";
        return /quiet part/i.test(q);
      }, null, { timeout: 15000 });

      const after = await page.evaluate(() => ({
        question: (document.querySelector(".writing-question") || {}).textContent || "",
        error: !!document.querySelector(".writing-card--error"),
        keep: (document.getElementById("writing-next") || {}).textContent || "",
        premature: /Quiet software compounds|premature|Nope/i.test(
          (document.querySelector(".writing-question") || {}).textContent || ""
        ),
        calls: (window.__claudeLog || []).length,
        keepFlag: (window.__claudeLog || []).some((c) =>
          /Keep crafting/i.test(((c.messages || [])[0] || {}).content || "")
        ),
      }));
      assert.notEqual(after.question, before);
      assert.match(after.question, /quiet part/i);
      assert.equal(after.error, false);
      assert.match(after.keep, /Keep crafting/i);
      assert.equal(after.premature, false);
      assert.ok(after.calls >= 2);
      assert.equal(after.keepFlag, true);

      fs.mkdirSync(ART, { recursive: true });
      await page.screenshot({ path: path.join(ART, "keep-crafting-e2e.png"), fullPage: false });
      await context.close();
    } finally {
      await browser.close();
      server.close();
    }
  });

  test("three empty/done replies fall back to a stage question without an error card", async () => {
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
      const done = {
        text: JSON.stringify({
          next_question: null,
          done: true,
          stitched_body: "premature",
          stitched_title: "Nope",
        }),
      };
      await bootYou(page, base, [done, done, done]);

      await page.fill(".writing-input", "Quiet software compounds when I stay close to the work.");
      await page.evaluate(() => document.getElementById("writing-next").click());
      await page.waitForFunction(() => {
        const err = document.querySelector(".writing-card--error");
        const q = (document.querySelector(".writing-question") || {}).textContent || "";
        return !err && q.length > 10 && !/Couldn't/i.test(q);
      }, null, { timeout: 15000 });

      const after = await page.evaluate(() => ({
        question: (document.querySelector(".writing-question") || {}).textContent || "",
        error: !!document.querySelector(".writing-card--error"),
        calls: (window.__claudeLog || []).length,
      }));
      assert.equal(after.error, false);
      assert.equal(after.calls, 3);
      assert.match(after.question, /noticing|figuring|discovering|clearer|contradiction|understanding|recognising|coming to see|learning/i);
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

  test("network failure still shows a readable error card", async () => {
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
        { throwMessage: "network down for test" },
      ]);

      await page.fill(".writing-input", "An answer that should hit a network error.");
      await page.evaluate(() => document.getElementById("writing-next").click());
      await page.waitForSelector(".writing-card--error", { timeout: 10000 });

      const err = await page.evaluate(() => {
        const card = document.querySelector(".writing-card--error");
        const pre = card && card.querySelector(".writing-error");
        const note = card && card.querySelector(".writing-note");
        const cs = pre ? getComputedStyle(pre) : null;
        return {
          heading: (card.querySelector(".writing-question") || {}).textContent || "",
          msg: (pre || {}).textContent || "",
          note: (note || {}).textContent || "",
          color: cs ? cs.color : "",
          keep: (document.getElementById("writing-next") || {}).textContent || "",
        };
      });
      assert.match(err.heading, /Couldn't reach Claude/i);
      assert.match(err.msg, /network down/i);
      assert.match(err.keep, /Keep crafting/i);
      // rgb(92, 36, 16) == #5c2410
      assert.match(err.color, /rgb\(\s*92,\s*36,\s*16\s*\)/);

      fs.mkdirSync(ART, { recursive: true });
      await page.screenshot({ path: path.join(ART, "keep-crafting-error-contrast.png"), fullPage: false });
      await context.close();
    } finally {
      await browser.close();
      server.close();
    }
  });
});
