/* Preview smoke library — Browserbase scenario runner shared between the
 * Vercel function (api/preview-smoke.js) and the CLI wrapper
 * (scripts/run-preview-smoke.js).
 *
 * `runPreviewSmoke` opens one Browserbase cloud Chromium session, drives
 * it via CDP through each scenario in tests/preview/scenarios.json
 * against the supplied preview URL, and returns the structured results.
 *
 * `renderComment` shapes those results into a Markdown comment marked
 * with a hidden sentinel so the caller can upsert it in place via
 * `upsertComment`. The sentinel keeps the comment unique per-PR; running
 * twice edits the existing one instead of stacking new ones.
 *
 * No env-var reads happen in here — every secret is passed in by the
 * caller. Browserbase keys live in Vercel project env (for the function)
 * or in .env.local pulled by `vercel env pull` (for the CLI).
 */

"use strict";

const fs = require("fs");
const path = require("path");

const BB_API_BASE = "https://api.browserbase.com/v1";
const GH_API_BASE = "https://api.github.com";

const COMMENT_MARKER = "<!-- tinker-preview-smoke -->";

const SESSION_TIMEOUT_SECONDS = 300;
const SCENARIO_LOAD_TIMEOUT_MS = 15_000;
const CDP_OPEN_TIMEOUT_MS = 30_000;

function slug(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function loadScenarios(scenariosPath) {
  if (!fs.existsSync(scenariosPath)) return [];
  const raw = JSON.parse(fs.readFileSync(scenariosPath, "utf8"));
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
    // Sessions self-expire on timeout; log and move on.
    console.warn(`[preview-smoke] session release failed: ${err.message}`);
  }
}

// Persistent CDP client over the Browserbase connect URL. Attaches once
// to the first page target with flatten:true, then routes commands
// through that page session. Holds the socket open across scenarios.
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

  let screenshotName = null;
  let screenshotBase64 = null;
  try {
    const shotRes = await cdp.send("Page.captureScreenshot", { format: "png" });
    if (shotRes.data) {
      screenshotBase64 = shotRes.data;
      screenshotName = `${slug(scenario.name)}.png`;
      if (screenshotsDir) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
        fs.writeFileSync(
          path.join(screenshotsDir, screenshotName),
          Buffer.from(shotRes.data, "base64"),
        );
      }
    }
  } catch (err) {
    console.warn(`[preview-smoke] ${scenario.name} screenshot failed: ${err.message}`);
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
    screenshot: screenshotName,
    screenshotBase64,
  };
}

async function runPreviewSmoke({
  previewUrl,
  scenarios,
  bbApiKey,
  bbProjectId,
  screenshotsDir = null,
}) {
  if (!previewUrl) throw new Error("previewUrl is required");
  if (!Array.isArray(scenarios)) throw new Error("scenarios array is required");
  if (!bbApiKey || !bbProjectId) {
    throw new Error("bbApiKey and bbProjectId are required");
  }

  const session = await openBrowserbaseSession({
    apiKey: bbApiKey,
    projectId: bbProjectId,
  });

  const results = [];
  let cdp;
  try {
    cdp = await connectCDP(session.connectUrl);
    for (const scenario of scenarios) {
      const result = await runBrowserScenario({
        cdp,
        baseUrl: previewUrl,
        scenario,
        screenshotsDir,
      });
      results.push(result);
    }
  } finally {
    try {
      cdp?.close();
    } catch {}
    await endSession({
      apiKey: bbApiKey,
      sessionId: session.id,
      projectId: bbProjectId,
    });
  }

  return { sessionId: session.id, results };
}

function renderComment({ results, previewUrl, sha, screenshotsUrl }) {
  const shortSha = String(sha).slice(0, 7);

  const rows = results.map((r) => {
    const status = r.ok ? "PASS" : "FAIL";
    const detail = String(r.detail).replace(/\|/g, "\\|");
    return `| ${r.name} | ${status} | ${detail} |`;
  });

  // Strip the heavy base64 payload from the embedded JSON; it would
  // bloat the comment past GitHub's body limit on multi-scenario runs.
  const compact = results.map(({ screenshotBase64, ...rest }) => rest);
  const json = JSON.stringify(
    { sha, previewUrl, scenarios: compact },
    null,
    2,
  );

  const header = screenshotsUrl
    ? `Preview: ${previewUrl} · [Screenshots](${screenshotsUrl})`
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

module.exports = {
  COMMENT_MARKER,
  loadScenarios,
  runPreviewSmoke,
  renderComment,
  upsertComment,
};
