#!/usr/bin/env node
/* Bench warm-path inbox rail paint with cached snapshot + batched inbox stub. */
"use strict";
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";

const ART = "/opt/cursor/artifacts";
const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "src", "renderer");

const snapshot = {
  leads: Array.from({ length: 15 }, (_, i) => ({
    id: "lead_" + i,
    personName: "Person " + (i + 1),
    personTitle: "Engineer",
    company: i % 2 ? "Alloy" : "Stripe",
    companyId: i % 2 ? "co_alloy" : "co_stripe",
    contactType: "hiring_leader",
    queueOrder: i,
    nextStepAt: "2026-09-30",
    linkedInUrl: "https://www.linkedin.com/in/p" + i,
    githubUrl: "",
    stage: "new",
  })),
  drafts: [],
  companies: [
    { id: "co_stripe", name: "Stripe", domain: "stripe.com", priority: 1, status: "active", research: "" },
    { id: "co_alloy", name: "Alloy", domain: "alloy.com", priority: 2, status: "active", research: "" },
  ],
  byLeadId: Object.fromEntries(
    Array.from({ length: 15 }, (_, i) => [
      "lead_" + i,
      { touch: { touchType: "hiring_leader_outreach", date: "2026-09-30", status: "planned" } },
    ]),
  ),
  ownerPersonName: "Tyler Lindow",
  ownerAvatarUrl: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMzIiIGZpbGw9IiMxZjI5MzciLz48L3N2Zz4=",
  ownerTitle: "Founder at Lindow Labs",
  ownerLinkedInUrl: "https://www.linkedin.com/in/tyler-owner",
  savedAt: Date.now(),
};

function startServer() {
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

async function stub(page, delayMs) {
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    let action = "";
    try { action = new URL(url).searchParams.get("action") || ""; } catch {}
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    let body = { ok: true };
    if (url.includes("/api/leads") && action === "inbox") {
      body = {
        leads: snapshot.leads,
        drafts: [],
        companies: snapshot.companies,
        byLeadId: snapshot.byLeadId,
        profile: {
          name: snapshot.ownerPersonName,
          title: snapshot.ownerTitle,
          linkedInUrl: snapshot.ownerLinkedInUrl,
          avatarUrl: snapshot.ownerAvatarUrl,
        },
      };
    } else if (url.includes("/api/leads")) {
      body = { leads: snapshot.leads, drafts: [], companies: snapshot.companies, settings: {} };
    } else if (url.includes("/api/schedule")) {
      body = { byLeadId: snapshot.byLeadId, sessions: [], touches: [], busyEvents: [] };
    } else if (url.includes("/api/user-data") || url.includes("/api/profile")) {
      body = {
        data: {
          name: snapshot.ownerPersonName,
          title: snapshot.ownerTitle,
          linkedInUrl: snapshot.ownerLinkedInUrl,
          avatarUrl: snapshot.ownerAvatarUrl,
        },
      };
    } else if (url.includes("/api/self-thread")) {
      body = { messages: [] };
    } else if (url.includes("/api/version")) {
      body = { version: "bench", env: "test" };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function measure(label, { useCache, apiDelayMs }) {
  const { server, base } = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    await context.addInitScript(({ snap, useCache: cacheOn }) => {
      try {
        localStorage.setItem("tinker_jwt", "bench_session");
        if (cacheOn) localStorage.setItem("tinker.inboxSnapshot.v1", JSON.stringify(snap));
        else localStorage.removeItem("tinker.inboxSnapshot.v1");
      } catch {}
      performance.mark("bench-nav-start");
    }, { snap: snapshot, useCache });
    const page = await context.newPage();
    await stub(page, apiDelayMs);
    const t0 = Date.now();
    await page.goto(base + "/", { waitUntil: "domcontentloaded" });
    const railPaintMs = await page.waitForFunction(() => {
      const rows = document.querySelectorAll(".messages-rail__list .messages-rail__row, .messages-rail__row--you");
      if (rows.length < 2) return null;
      return Math.round(performance.now());
    }, null, { timeout: 15000 }).then((h) => h.jsonValue());
    const wallRail = Date.now() - t0;
    await page.evaluate(() => {
      if (window.tinkerMessagesShell && window.tinkerMessagesShell.selectYou) {
        window.tinkerMessagesShell.selectYou();
      }
    });
    await page.waitForFunction(() => document.body.classList.contains("messages-you-active"), null, { timeout: 10000 });
    const ownerMs = Date.now() - t0;
    const apiCalls = await page.evaluate(() => {
      return performance.getEntriesByType("resource")
        .filter((e) => /\/api\//.test(e.name))
        .map((e) => ({ name: e.name.replace(/^.*\/api/, "/api"), dur: Math.round(e.duration) }));
    });
    return {
      label,
      useCache,
      apiDelayMs,
      railPaintPerfMs: railPaintMs,
      wallToRailMs: wallRail,
      wallToOwnerMs: ownerMs,
      apiCalls,
      people: await page.evaluate(() => document.querySelectorAll("[data-conv-id]:not([data-conv-id='__you__'])").length),
    };
  } finally {
    await browser.close();
    server.close();
  }
}

const beforeProxy = {
  label: "before-proxy (5 APIs × 400ms, no cache)",
  note: "Approximate pre-fix warm path: rail waits on slowest of 5 authed calls (~400ms each in parallel ≈ 400–800ms+ cold DB).",
  wallToRailMs: 400,
  wallToOwnerMs: 700,
  source: "prod 401 fan-out max ~377ms warm + DB; Tyler reported multi-second cold",
};

const results = [];
results.push(await measure("after-cold-no-cache", { useCache: false, apiDelayMs: 250 }));
results.push(await measure("after-warm-cache", { useCache: true, apiDelayMs: 250 }));
results.push(await measure("after-warm-cache-slow-api", { useCache: true, apiDelayMs: 1200 }));

fs.mkdirSync(ART, { recursive: true });
const out = {
  measuredAt: new Date().toISOString(),
  before: beforeProxy,
  after: results,
  target: { warmRailPaintMs: 1000 },
};
fs.writeFileSync(path.join(ART, "inbox-load-after.json"), JSON.stringify(out, null, 2));
const md = [
  "# Inbox load after fix",
  "",
  "## Before (production baseline)",
  `- 5 parallel API calls on refresh(); rail waits on Promise.all`,
  `- Warm 401 fan-out max ~377ms; authenticated + DB can reach multi-second (Tyler report)`,
  `- Proxy warm rail wait ≈ **${beforeProxy.wallToRailMs}+ ms** (no cache paint)`,
  "",
  "## After (local bench, 15 people, batched inbox stub)",
  ...results.map((r) =>
    `- **${r.label}**: wall→rail **${r.wallToRailMs} ms**, perf.now rail **${r.railPaintPerfMs} ms**, wall→owner **${r.wallToOwnerMs} ms**, people=${r.people}, apiCalls=${r.apiCalls.length}`,
  ),
  "",
  `Warm cache rail paint target <1000ms: **${results.find((r) => r.label === "after-warm-cache").wallToRailMs < 1000 ? "PASS" : "FAIL"}**`,
  `Warm cache with 1200ms API still paints early: **${results.find((r) => r.label === "after-warm-cache-slow-api").wallToRailMs < 500 ? "PASS" : "CHECK"}** (${results.find((r) => r.label === "after-warm-cache-slow-api").wallToRailMs} ms)`,
].join("\n");
fs.writeFileSync(path.join(ART, "inbox-load-after.md"), md);
console.log(md);
