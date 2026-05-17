#!/usr/bin/env node
/**
 * Browserbase preview walkthrough.
 *
 * Drives the live preview deployment through a list of product flows
 * (scripts/preview-flows.js) in a Browserbase-hosted Chromium session,
 * captures a screenshot at the end of each flow, and records every
 * browser console event along the way. The output lives under
 * artifacts/ — both individual files and a machine-readable summary
 * the PR-update step reads next.
 *
 * Env (required):
 *   PREVIEW_URL                Vercel preview URL to walk
 *   BROWSERBASE_API_KEY        from the Vercel ↔ Browserbase integration
 *   BROWSERBASE_PROJECT_ID     same source
 *
 * Env (optional):
 *   TINKER_TEST_SESSION_TOKEN  Stytch session_token for an authed test
 *                              user. If absent, flows marked auth:true
 *                              are skipped with a note.
 *   OUT_DIR                    where to write artifacts (default ./artifacts)
 *
 * Exits non-zero only on harness failure (couldn't reach Browserbase,
 * couldn't load any flow, etc.). Per-flow failures are recorded in the
 * summary so the PR comment can surface them without breaking CI on
 * the first regression.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const Browserbase = require("@browserbasehq/sdk").default;
const { chromium } = require("playwright-core");

const FLOWS = require("./preview-flows.js");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeName(name) {
  return name.replace(/[^a-z0-9._-]+/gi, "-").toLowerCase();
}

async function createSession() {
  const apiKey = requireEnv("BROWSERBASE_API_KEY");
  const projectId = requireEnv("BROWSERBASE_PROJECT_ID");
  const bb = new Browserbase({ apiKey });
  const session = await bb.sessions.create({ projectId });
  // Browserbase exposes the human-facing session inspector at this
  // path. We surface the URL in the PR comment so reviewers can scrub
  // the recording themselves.
  const inspectorUrl = `https://www.browserbase.com/sessions/${session.id}`;
  return { session, inspectorUrl };
}

function attachConsoleCapture(page, sink) {
  page.on("console", (msg) => {
    sink.push({
      kind: "console",
      level: msg.type(),
      text: msg.text(),
      at: new Date().toISOString(),
    });
  });
  page.on("pageerror", (err) => {
    sink.push({
      kind: "pageerror",
      level: "error",
      text: String(err && err.message ? err.message : err),
      at: new Date().toISOString(),
    });
  });
  page.on("requestfailed", (req) => {
    const failure = req.failure();
    sink.push({
      kind: "requestfailed",
      level: "warning",
      text: `${req.method()} ${req.url()} — ${failure ? failure.errorText : "failed"}`,
      at: new Date().toISOString(),
    });
  });
}

async function runFlow(browserContext, flow, { url, sessionToken, outDir }) {
  const events = [];
  const startedAt = new Date().toISOString();
  const result = {
    name: flow.name,
    description: flow.description || "",
    viewport: flow.viewport || null,
    authed: !!flow.auth,
    startedAt,
    endedAt: null,
    status: "pending",
    skipReason: null,
    error: null,
    screenshot: null,
    events,
  };

  if (flow.auth && !sessionToken) {
    result.status = "skipped";
    result.skipReason = "TINKER_TEST_SESSION_TOKEN not set";
    result.endedAt = new Date().toISOString();
    return result;
  }

  // A fresh page per flow keeps console events scoped and avoids one
  // flow's leftover state (modals, focus, scroll) bleeding into the
  // next screenshot.
  const page = await browserContext.newPage();
  if (flow.viewport) {
    await page.setViewportSize(flow.viewport);
  }
  attachConsoleCapture(page, events);

  // Inject the Stytch session token before any of the renderer's
  // own scripts run, so auth.js sees the token on its first read.
  if (flow.auth && sessionToken) {
    const safeToken = JSON.stringify(sessionToken);
    await page.addInitScript(
      `try { localStorage.setItem('tinker_jwt', ${safeToken}); } catch (e) {}`,
    );
  }

  try {
    await flow.run(page, { url });
    const file = path.join(outDir, "screenshots", `${safeName(flow.name)}.png`);
    ensureDir(path.dirname(file));
    await page.screenshot({ path: file, fullPage: true });
    result.screenshot = path.relative(outDir, file);
    result.status = "ok";
  } catch (err) {
    result.status = "failed";
    result.error = String(err && err.message ? err.message : err);
    // Best-effort screenshot of whatever was on screen when it broke —
    // often more useful for debugging than the stack trace alone.
    try {
      const file = path.join(
        outDir,
        "screenshots",
        `${safeName(flow.name)}-failure.png`,
      );
      ensureDir(path.dirname(file));
      await page.screenshot({ path: file, fullPage: true });
      result.screenshot = path.relative(outDir, file);
    } catch {
      // Swallow — we already have the original error recorded.
    }
  } finally {
    result.endedAt = new Date().toISOString();
    await page.close().catch(() => {});
  }

  return result;
}

async function main() {
  const url = requireEnv("PREVIEW_URL");
  const sessionToken = process.env.TINKER_TEST_SESSION_TOKEN || "";
  const outDir = path.resolve(process.env.OUT_DIR || "artifacts");

  ensureDir(outDir);
  ensureDir(path.join(outDir, "screenshots"));

  console.log(`[browserbase] preview url: ${url}`);
  console.log(`[browserbase] authed flows: ${sessionToken ? "enabled" : "skipped (no TINKER_TEST_SESSION_TOKEN)"}`);
  console.log(`[browserbase] output dir: ${outDir}`);

  const { session, inspectorUrl } = await createSession();
  console.log(`[browserbase] session ${session.id} — ${inspectorUrl}`);

  const browser = await chromium.connectOverCDP(session.connectUrl);
  // Browserbase opens a default context with one page; reuse it so
  // the session shows the activity we drive rather than an empty tab.
  const context = browser.contexts()[0] || (await browser.newContext());

  const results = [];
  try {
    for (const flow of FLOWS) {
      console.log(`[browserbase] → ${flow.name}`);
      const result = await runFlow(context, flow, {
        url,
        sessionToken,
        outDir,
      });
      console.log(
        `[browserbase] ← ${flow.name}: ${result.status}` +
          (result.error ? ` — ${result.error}` : ""),
      );
      results.push(result);

      const logFile = path.join(outDir, "logs", `${safeName(flow.name)}.json`);
      ensureDir(path.dirname(logFile));
      fs.writeFileSync(logFile, JSON.stringify(result.events, null, 2));
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const summary = {
    previewUrl: url,
    sessionId: session.id,
    inspectorUrl,
    generatedAt: new Date().toISOString(),
    commit: process.env.PR_SHA || process.env.GITHUB_SHA || null,
    prNumber: process.env.PR_NUMBER ? Number(process.env.PR_NUMBER) : null,
    flows: results,
  };
  fs.writeFileSync(
    path.join(outDir, "summary.json"),
    JSON.stringify(summary, null, 2),
  );

  const failed = results.filter((r) => r.status === "failed");
  console.log(
    `[browserbase] done — ${results.length} flow(s), ${failed.length} failure(s)`,
  );
  // Non-zero only when the harness itself failed. Per-flow failures
  // are surfaced via the PR comment.
}

main().catch((err) => {
  console.error("[browserbase] harness error:", err);
  process.exit(1);
});
