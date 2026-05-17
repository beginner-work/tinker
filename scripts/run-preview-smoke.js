#!/usr/bin/env node
/**
 * Run declarative browser smoke scenarios against a Vercel preview deploy,
 * then upsert the results into a single PR comment so Claude can read them.
 *
 * The runner does three things in order:
 *
 *   1. Poll the Vercel REST API until the deployment whose
 *      meta.githubCommitSha matches HEAD_SHA reaches state=READY.
 *   2. Open one Browserbase cloud Chromium session and drive it via CDP
 *      through each scenario in tests/preview/scenarios.json. Per scenario
 *      we capture: load status, page title, final URL, console errors,
 *      uncaught exceptions, and a PNG screenshot.
 *   3. Render a Markdown comment (hidden marker + table + fenced JSON)
 *      and either POST it or PATCH the existing one identified by the
 *      hidden marker, so the comment is upserted in place.
 *
 * Env (all required unless noted):
 *   GITHUB_TOKEN          — repo-scoped token with pull-requests: write
 *   GITHUB_REPOSITORY     — owner/repo, set automatically in Actions
 *   PR_NUMBER             — the PR to comment on
 *   HEAD_SHA              — commit SHA the preview was built from
 *   VERCEL_TOKEN          — Vercel personal token (deployments:read)
 *   VERCEL_PROJECT_ID     — Vercel project to filter deployments by
 *   BROWSERBASE_API_KEY   — Browserbase API key
 *   BROWSERBASE_PROJECT_ID — Browserbase project
 *   SCREENSHOTS_DIR       — where to write PNGs (default: os tmp)
 *   DRY_RUN=true          — print the comment body, don't POST/PATCH
 *   GITHUB_RUN_ID         — used to link to the workflow run artifacts
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const BB_API_BASE = "https://api.browserbase.com/v1";
const VERCEL_API_BASE = "https://api.vercel.com";
const GH_API_BASE = "https://api.github.com";

const COMMENT_MARKER = "<!-- tinker-preview-smoke -->";

const POLL_INTERVAL_MS = 5_000;
const POLL_CEILING_MS = 5 * 60 * 1000;
const NO_DEPLOYMENT_GRACE_MS = 60_000;
const SESSION_TIMEOUT_SECONDS = 300;
const SCENARIO_LOAD_TIMEOUT_MS = 15_000;
const CDP_OPEN_TIMEOUT_MS = 30_000;

// Mirror scripts/browserbase-debug.js loadDotEnv — read BROWSERBASE_* and
// any other vars out of .env.local (written by `vercel env pull`) so the
// only secret GitHub Actions needs is VERCEL_TOKEN. process.env always wins.
function loadDotEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = path.resolve(__dirname, "..", name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const [, key, rawValue] = m;
      if (process.env[key] != null) continue;
      let value = rawValue.trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ----- Config -----

function readEnv() {
  const env = {
    githubToken: process.env.GITHUB_TOKEN,
    repo: process.env.GITHUB_REPOSITORY,
    prNumber: process.env.PR_NUMBER,
    headSha: process.env.HEAD_SHA,
    vercelToken: process.env.VERCEL_TOKEN,
    vercelProjectId: process.env.VERCEL_PROJECT_ID,
    bbApiKey: process.env.BROWSERBASE_API_KEY,
    bbProjectId: process.env.BROWSERBASE_PROJECT_ID,
    screenshotsDir:
      process.env.SCREENSHOTS_DIR ||
      path.join(os.tmpdir(), "preview-screenshots"),
    runId: process.env.GITHUB_RUN_ID || null,
    dryRun: process.env.DRY_RUN === "true",
  };
  const missing = [];
  for (const [k, v] of Object.entries({
    GITHUB_TOKEN: env.githubToken,
    GITHUB_REPOSITORY: env.repo,
    PR_NUMBER: env.prNumber,
    HEAD_SHA: env.headSha,
    VERCEL_TOKEN: env.vercelToken,
    VERCEL_PROJECT_ID: env.vercelProjectId,
    BROWSERBASE_API_KEY: env.bbApiKey,
    BROWSERBASE_PROJECT_ID: env.bbProjectId,
  })) {
    if (!v) missing.push(k);
  }
  if (missing.length) {
    console.error(`Missing required env: ${missing.join(", ")}`);
    process.exit(1);
  }
  return env;
}

function loadScenarios() {
  const p = path.resolve(__dirname, "..", "tests", "preview", "scenarios.json");
  if (!fs.existsSync(p)) {
    console.log(`[smoke] No scenarios file at ${p}; nothing to do.`);
    process.exit(0);
  }
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  if (!Array.isArray(raw.scenarios)) {
    throw new Error(`scenarios.json must contain a "scenarios" array.`);
  }
  for (const s of raw.scenarios) {
    if (!s.name || typeof s.name !== "string") {
      throw new Error(`Scenario is missing "name".`);
    }
    if (!s.path || typeof s.path !== "string") {
      throw new Error(`Scenario "${s.name}" is missing "path".`);
    }
  }
  return raw.scenarios;
}

// ----- Vercel polling -----

async function vercelFetch(endpoint, { token }) {
  const res = await fetch(`${VERCEL_API_BASE}${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel GET ${endpoint} -> ${res.status}: ${text}`);
  }
  return res.json();
}

async function waitForPreview({ vercelToken, projectId, sha }) {
  const start = Date.now();
  const params = new URLSearchParams({
    projectId,
    "meta-githubCommitSha": sha,
    limit: "5",
  });
  let lastState = "(no deployment row yet)";

  while (Date.now() - start < POLL_CEILING_MS) {
    const elapsed = Date.now() - start;
    const data = await vercelFetch(`/v6/deployments?${params}`, {
      token: vercelToken,
    });
    const match = (data.deployments || [])[0];

    if (match) {
      lastState = match.state || match.readyState || "UNKNOWN";
      if (lastState === "READY") {
        // Vercel returns the URL without scheme — see v6 schema.
        return {
          url: `https://${match.url}`,
          deploymentId: match.uid,
          state: lastState,
        };
      }
      if (lastState === "ERROR" || lastState === "CANCELED") {
        throw new Error(
          `Vercel deployment for ${sha} ended in state ${lastState} (id=${match.uid})`,
        );
      }
    } else if (elapsed > NO_DEPLOYMENT_GRACE_MS) {
      lastState = "(no deployment row found after grace window)";
    }

    console.log(`[wait] ${(elapsed / 1000).toFixed(0)}s state=${lastState}`);
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Timed out after ${POLL_CEILING_MS / 1000}s waiting for READY ` +
      `(last state=${lastState}, sha=${sha})`,
  );
}

// ----- Browserbase + CDP -----

async function bbFetch(endpoint, { method = "GET", body, apiKey } = {}) {
  const res = await fetch(`${BB_API_BASE}${endpoint}`, {
    method,
    headers: {
      "X-BB-API-Key": apiKey,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Browserbase ${method} ${endpoint} -> ${res.status}: ${text}`);
  }
  return res.json();
}

async function openBrowserbaseSession({ apiKey, projectId }) {
  const session = await bbFetch("/sessions", {
    method: "POST",
    apiKey,
    body: { projectId, timeout: SESSION_TIMEOUT_SECONDS },
  });
  return { id: session.id, connectUrl: session.connectUrl };
}

async function endSession({ apiKey, sessionId, projectId }) {
  try {
    await bbFetch(`/sessions/${sessionId}`, {
      method: "POST",
      apiKey,
      body: { projectId, status: "REQUEST_RELEASE" },
    });
  } catch (err) {
    // The session expires on its own timeout if release fails; log and move on.
    console.warn(`[end] session release failed: ${err.message}`);
  }
}

// Lightweight CDP client over the Browserbase connect URL. Attaches once
// to the first page target with flatten:true, then routes subsequent
// commands through that session. Holds the socket open across scenarios.
function connectCDP(connectUrl) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket === "undefined") {
      reject(new Error("Node 22.4+ required for built-in WebSocket"));
      return;
    }
    const ws = new WebSocket(connectUrl);
    const pending = new Map();
    const listeners = new Map();
    let nextId = 1;
    let pageSessionId = null;

    const sendRaw = (method, params = {}) =>
      new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
      });

    const send = (method, params = {}) =>
      new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { res, rej });
        ws.send(
          JSON.stringify({
            id,
            method,
            params,
            ...(pageSessionId ? { sessionId: pageSessionId } : {}),
          }),
        );
      });

    const on = (method, cb) => {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(cb);
      return () => listeners.get(method)?.delete(cb);
    };

    const openTimer = setTimeout(() => {
      ws.close();
      reject(new Error(`CDP connect timed out after ${CDP_OPEN_TIMEOUT_MS}ms`));
    }, CDP_OPEN_TIMEOUT_MS);

    ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.id != null && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
        else res(msg.result || {});
        return;
      }
      if (msg.method && listeners.has(msg.method)) {
        for (const cb of listeners.get(msg.method)) cb(msg.params || {});
      }
    });

    ws.addEventListener("error", (err) => {
      clearTimeout(openTimer);
      reject(new Error(`WebSocket error: ${err?.message || "unknown"}`));
    });

    ws.addEventListener("close", () => {
      for (const { rej } of pending.values()) rej(new Error("CDP WebSocket closed"));
      pending.clear();
    });

    ws.addEventListener("open", async () => {
      try {
        const targets = await sendRaw("Target.getTargets");
        const page = (targets.targetInfos || []).find((t) => t.type === "page");
        if (!page) throw new Error("No page target in cloud browser");
        const attach = await sendRaw("Target.attachToTarget", {
          targetId: page.targetId,
          flatten: true,
        });
        pageSessionId = attach.sessionId;
        clearTimeout(openTimer);
        resolve({ send, on, close: () => ws.close() });
      } catch (err) {
        clearTimeout(openTimer);
        ws.close();
        reject(err);
      }
    });
  });
}

// ----- Scenario execution -----

async function runBrowserScenario({ cdp, baseUrl, scenario, screenshotsDir }) {
  const url = new URL(scenario.path, baseUrl).toString();
  const consoleErrors = [];
  const exceptions = [];

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const offConsole = cdp.on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error") {
      const text = (p.args || [])
        .map((a) => a.value ?? a.description ?? "")
        .join(" ");
      consoleErrors.push(text || "(empty console.error)");
    }
  });
  const offException = cdp.on("Runtime.exceptionThrown", (p) => {
    exceptions.push(p.exceptionDetails?.text || "exception");
  });

  let loadStatus = "fired";
  const startMs = Date.now();

  const loadFired = new Promise((res) => {
    let unsub;
    const t = setTimeout(() => {
      unsub?.();
      loadStatus = "timeout";
      res();
    }, SCENARIO_LOAD_TIMEOUT_MS);
    unsub = cdp.on("Page.loadEventFired", () => {
      clearTimeout(t);
      unsub();
      res();
    });
  });

  try {
    await cdp.send("Page.navigate", { url });
  } catch (err) {
    loadStatus = "navigate_error";
    consoleErrors.push(`navigation: ${err.message}`);
  }
  await loadFired;
  const loadMs = Date.now() - startMs;

  let title = "";
  let finalUrl = url;
  try {
    const titleRes = await cdp.send("Runtime.evaluate", {
      expression: "document.title",
      returnByValue: true,
    });
    title = titleRes.result?.value ?? "";
    const urlRes = await cdp.send("Runtime.evaluate", {
      expression: "location.href",
      returnByValue: true,
    });
    finalUrl = urlRes.result?.value ?? url;
  } catch {
    // Non-HTML responses can fail evaluate. Leave defaults.
  }

  let screenshotPath = null;
  try {
    const shotRes = await cdp.send("Page.captureScreenshot", { format: "png" });
    if (shotRes.data) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
      screenshotPath = path.join(screenshotsDir, `${slug(scenario.name)}.png`);
      fs.writeFileSync(screenshotPath, Buffer.from(shotRes.data, "base64"));
    }
  } catch (err) {
    console.warn(`[scenario] ${scenario.name} screenshot failed: ${err.message}`);
  }

  offConsole();
  offException();

  const allErrors = [...exceptions, ...consoleErrors];
  const failures = [];
  const expect = scenario.expect || {};
  if (expect.loadStatus && loadStatus !== expect.loadStatus) {
    failures.push(`loadStatus=${loadStatus}, expected ${expect.loadStatus}`);
  }
  if (expect.noConsoleErrors === true && allErrors.length > 0) {
    failures.push(`${allErrors.length} console error(s): ${allErrors[0]}`);
  }
  if (
    expect.titleContains &&
    !String(title).toLowerCase().includes(String(expect.titleContains).toLowerCase())
  ) {
    failures.push(`title="${title}" missing "${expect.titleContains}"`);
  }
  if (expect.urlEndsWith && !String(finalUrl).endsWith(expect.urlEndsWith)) {
    failures.push(`url=${finalUrl} doesn't end with ${expect.urlEndsWith}`);
  }

  return {
    name: scenario.name,
    ok: failures.length === 0,
    detail:
      failures.length > 0
        ? failures.join("; ")
        : `loaded in ${loadMs}ms${title ? `, title="${title}"` : ""}`,
    loadStatus,
    loadMs,
    title,
    finalUrl,
    consoleErrors: allErrors,
    screenshot: screenshotPath ? path.basename(screenshotPath) : null,
  };
}

// ----- Comment rendering & upsert -----

async function ghFetch(endpoint, { method = "GET", body, token } = {}) {
  const res = await fetch(`${GH_API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "tinker-preview-smoke",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${method} ${endpoint} -> ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function renderComment({ results, previewUrl, sha, repo, runId }) {
  const shortSha = sha.slice(0, 7);
  const artifactsUrl = runId
    ? `https://github.com/${repo}/actions/runs/${runId}`
    : null;

  const rows = results.map((r) => {
    const status = r.ok ? "PASS" : "FAIL";
    const detail = String(r.detail).replace(/\|/g, "\\|");
    return `| ${r.name} | ${status} | ${detail} |`;
  });

  const json = JSON.stringify(
    { sha, previewUrl, scenarios: results },
    null,
    2,
  );

  const header = artifactsUrl
    ? `Preview: ${previewUrl} · [Screenshot artifacts](${artifactsUrl})`
    : `Preview: ${previewUrl}`;

  return [
    COMMENT_MARKER,
    `### Preview smoke · \`${shortSha}\``,
    header,
    "",
    "| Scenario | Result | Detail |",
    "|---|---|---|",
    ...rows,
    "",
    "<details><summary>Machine-readable results</summary>",
    "",
    "```json",
    json,
    "```",
    "",
    "</details>",
  ].join("\n");
}

async function upsertComment({ repo, prNumber, body, token }) {
  const comments = await ghFetch(
    `/repos/${repo}/issues/${prNumber}/comments?per_page=100`,
    { token },
  );
  const existing = (comments || []).find(
    (c) => c.body && c.body.includes(COMMENT_MARKER),
  );
  if (existing) {
    await ghFetch(`/repos/${repo}/issues/comments/${existing.id}`, {
      method: "PATCH",
      token,
      body: { body },
    });
    return { action: "patched", id: existing.id };
  }
  const posted = await ghFetch(`/repos/${repo}/issues/${prNumber}/comments`, {
    method: "POST",
    token,
    body: { body },
  });
  return { action: "posted", id: posted.id };
}

// ----- Main -----

async function main() {
  loadDotEnv();
  const env = readEnv();
  const scenarios = loadScenarios();
  console.log(
    `[smoke] ${scenarios.length} scenario(s); sha=${env.headSha} pr=#${env.prNumber}`,
  );

  console.log(`[smoke] Waiting for Vercel preview for ${env.headSha}...`);
  const preview = await waitForPreview({
    vercelToken: env.vercelToken,
    projectId: env.vercelProjectId,
    sha: env.headSha,
  });
  console.log(`[smoke] Preview READY: ${preview.url}`);

  console.log(`[smoke] Opening Browserbase session...`);
  const session = await openBrowserbaseSession({
    apiKey: env.bbApiKey,
    projectId: env.bbProjectId,
  });
  console.log(`[smoke] Session ${session.id} open. Connecting CDP...`);

  const results = [];
  let cdp;
  try {
    cdp = await connectCDP(session.connectUrl);
    for (const scenario of scenarios) {
      console.log(`[smoke] -> ${scenario.name}`);
      const result = await runBrowserScenario({
        cdp,
        baseUrl: preview.url,
        scenario,
        screenshotsDir: env.screenshotsDir,
      });
      console.log(`[smoke]    ${result.ok ? "PASS" : "FAIL"}: ${result.detail}`);
      results.push(result);
    }
  } finally {
    try {
      cdp?.close();
    } catch {}
    await endSession({
      apiKey: env.bbApiKey,
      sessionId: session.id,
      projectId: env.bbProjectId,
    });
  }

  const body = renderComment({
    results,
    previewUrl: preview.url,
    sha: env.headSha,
    repo: env.repo,
    runId: env.runId,
  });

  if (env.dryRun) {
    console.log("\n--- DRY RUN: comment body ---\n");
    console.log(body);
    return;
  }

  const upsert = await upsertComment({
    repo: env.repo,
    prNumber: env.prNumber,
    body,
    token: env.githubToken,
  });
  console.log(`[smoke] Comment ${upsert.action} (id=${upsert.id})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
