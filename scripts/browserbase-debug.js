#!/usr/bin/env node
/**
 * Spin up a Browserbase cloud Chromium pointed at a preview URL so you
 * can debug a Vercel preview deploy in a real browser with full DevTools.
 *
 * Reach for this when a preview is misbehaving in a way you can't
 * reproduce locally — for example, the auth flow only breaks under
 * Vercel's edge network, or a third-party widget only loads from a
 * non-localhost origin. The script creates a session, navigates the
 * cloud browser to your URL via CDP, and prints a live debug URL
 * you open in your own browser. From there you get the Network tab,
 * Console, Elements, etc., running against the live preview.
 *
 * Env:
 *   BROWSERBASE_API_KEY     required
 *   BROWSERBASE_PROJECT_ID  required
 *
 *   (Both are auto-loaded from .env.local if present, so
 *    `npx vercel env pull` followed by this script Just Works.)
 *
 * Args:
 *   --url <preview-url>   Navigate to this URL on launch (optional —
 *                         omit to get a blank cloud browser).
 *   --timeout <seconds>   Session idle timeout (default 600 = 10 min).
 *                         The session ends automatically after this many
 *                         seconds of inactivity, no cleanup needed.
 *   -h, --help            Show usage.
 *
 * Usage:
 *   node scripts/browserbase-debug.js --url https://tinker-abc.vercel.app
 *   npm run debug:preview -- --url https://tinker-abc.vercel.app
 */

"use strict";

const fs = require("fs");
const path = require("path");

const API_BASE = "https://api.browserbase.com/v1";
const DEFAULT_TIMEOUT_SECONDS = 600;
const NAVIGATE_TIMEOUT_MS = 30_000;

// Pull vars out of .env.local for convenience after `vercel env pull`.
// process.env always wins so an explicit shell export overrides the file.
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

function parseArgs(argv) {
  const args = { timeout: DEFAULT_TIMEOUT_SECONDS };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--url") args.url = argv[++i];
    else if (flag === "--timeout") args.timeout = Number(argv[++i]);
    else if (flag === "-h" || flag === "--help") args.help = true;
    else {
      console.error(`Unknown argument: ${flag}`);
      process.exit(1);
    }
  }
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) {
    console.error(`--timeout must be a positive number of seconds.`);
    process.exit(1);
  }
  return args;
}

function printHelp() {
  console.log(
    [
      "Usage: node scripts/browserbase-debug.js [options]",
      "",
      "Options:",
      "  --url <preview-url>   Navigate the cloud browser to this URL on launch",
      "  --timeout <seconds>   Session idle timeout (default 600 = 10 minutes)",
      "  -h, --help            Show this help",
      "",
      "Required env: BROWSERBASE_API_KEY, BROWSERBASE_PROJECT_ID",
    ].join("\n"),
  );
}

async function browserbaseFetch(endpoint, { method = "GET", body, apiKey } = {}) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
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

// Drive the browser via Chrome DevTools Protocol over the connect URL.
// We attach to the first page target with `flatten: true` (so all
// subsequent messages flow over the same socket via `sessionId`) and
// send Page.navigate. The script exits after navigate is acknowledged
// — we don't wait for full load so the user sees the page paint live
// in the live-view URL.
function navigateViaCDP({ connectUrl, url }) {
  if (typeof WebSocket === "undefined") {
    throw new Error(
      "Auto-navigation needs the built-in WebSocket (Node 22.4+). " +
        "Open the live URL below and navigate manually in the cloud browser.",
    );
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(connectUrl);
    const pending = new Map();
    let nextId = 1;

    const send = (method, params, sessionId) => {
      const id = nextId++;
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        ws.send(
          JSON.stringify({
            id,
            method,
            params: params || {},
            ...(sessionId ? { sessionId } : {}),
          }),
        );
      });
    };

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`CDP timed out after ${NAVIGATE_TIMEOUT_MS}ms`));
    }, NAVIGATE_TIMEOUT_MS);

    ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.id == null || !pending.has(msg.id)) return;
      const { resolve: r, reject: rj } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rj(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
      else r(msg);
    });

    ws.addEventListener("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket error: ${err?.message ?? "unknown"}`));
    });

    ws.addEventListener("open", async () => {
      try {
        const targets = await send("Target.getTargets");
        const page = targets.result.targetInfos.find((t) => t.type === "page");
        if (!page) throw new Error("No page target in cloud browser");
        const attach = await send("Target.attachToTarget", {
          targetId: page.targetId,
          flatten: true,
        });
        const cdpSession = attach.result.sessionId;
        await send("Page.navigate", { url }, cdpSession);
        clearTimeout(timer);
        ws.close();
        resolve();
      } catch (err) {
        clearTimeout(timer);
        ws.close();
        reject(err);
      }
    });
  });
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey) {
    console.error("BROWSERBASE_API_KEY env var is required.");
    process.exit(1);
  }
  if (!projectId) {
    console.error("BROWSERBASE_PROJECT_ID env var is required.");
    process.exit(1);
  }

  console.log(`[browserbase-debug] Creating session (timeout=${args.timeout}s)...`);
  const session = await browserbaseFetch("/sessions", {
    method: "POST",
    apiKey,
    body: { projectId, timeout: args.timeout },
  });
  console.log(`[browserbase-debug] Session ${session.id} ready.`);

  if (args.url) {
    console.log(`[browserbase-debug] Navigating to ${args.url}...`);
    try {
      await navigateViaCDP({ connectUrl: session.connectUrl, url: args.url });
      console.log(`[browserbase-debug] Navigated.`);
    } catch (err) {
      console.warn(`[browserbase-debug] Auto-navigate failed: ${err.message}`);
      console.warn(`[browserbase-debug] Open the live URL and navigate by hand.`);
    }
  }

  const debug = await browserbaseFetch(`/sessions/${session.id}/debug`, { apiKey });
  console.log("");
  console.log("Live debug URL (open in your browser):");
  console.log(`  ${debug.debuggerFullscreenUrl}`);
  console.log("");
  console.log(`Session auto-expires after ${args.timeout}s. End it early with:`);
  console.log(
    `  curl -X POST -H "X-BB-API-Key: $BROWSERBASE_API_KEY" \\
       -H "Content-Type: application/json" \\
       -d '{"projectId":"'"$BROWSERBASE_PROJECT_ID"'","status":"REQUEST_RELEASE"}' \\
       https://api.browserbase.com/v1/sessions/${session.id}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
