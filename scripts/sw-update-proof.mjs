/* Prove a new deploy reaches an existing SW install without a manual cache clear.
 *
 * 1. Serve "old" shell (CACHE_VERSION v12 + DEPLOY_SHA=oldsha) and register SW.
 * 2. Flip the origin to "new" shell (v13 + DEPLOY_SHA=newsha from this PR).
 * 3. Trigger updatefound → skipWaiting → clients.claim → controllerchange reload.
 * 4. Assert the page reads the new sha (and network-first composer bytes).
 *
 * Writes /opt/cursor/artifacts/sw-update-proof.{log,json,png}.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const ART = "/opt/cursor/artifacts";
const PORT = 4177;

const REAL_SW = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
const REAL_OFFLINE = fs.readFileSync(path.join(root, "src/renderer/pwa-offline.js"), "utf8");
const REAL_COMPOSER = fs.readFileSync(path.join(root, "src/renderer/messages-composer.js"), "utf8");

const OLD_SHA = "oldsha-pre-deploy-v12";
const NEW_SHA = "newsha-network-first-v13";

let generation = "old";

function shellHtml(sha) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>SW update proof</title>
  <script>window.__DEPLOY_SHA__ = ${JSON.stringify(sha)};</script>
  <script src="/messages-composer.js" defer></script>
  <script src="/pwa-offline.js" defer></script>
</head>
<body>
  <main>
    <h1>SW update proof</h1>
    <p id="sha">${sha}</p>
    <p id="composer-mark"></p>
    <p id="sw-cache"></p>
  </main>
  <script>
    window.addEventListener("load", function () {
      var el = document.getElementById("composer-mark");
      el.textContent = window.__COMPOSER_MARK__ || "missing";
      navigator.serviceWorker.getRegistration().then(function (reg) {
        document.getElementById("sw-cache").textContent =
          (reg && reg.active && reg.active.scriptURL) || "no-active";
      });
    });
  </script>
</body>
</html>`;
}

function composerFor(gen) {
  const mark = gen === "old" ? "COMPOSER_OLD_V12" : "COMPOSER_NEW_V13";
  const sha = gen === "old" ? OLD_SHA : NEW_SHA;
  return (
    "window.__COMPOSER_MARK__ = " + JSON.stringify(mark) + ";\n" +
    "window.__COMPOSER_SHA__ = " + JSON.stringify(sha) + ";\n" +
    "// " + mark + "\n" +
    REAL_COMPOSER
  );
}

function swFor(gen) {
  if (gen === "new") return REAL_SW;
  return REAL_SW
    .replace(/tinker-shell-v13/g, "tinker-shell-v12")
    .replace(
      /if \(isShellAssetPath\(url\.pathname\)\) \{\s*event\.respondWith\(networkFirstAsset\(req\)\);\s*return;\s*\}/,
      "if (isShellAssetPath(url.pathname)) {\n    event.respondWith(staleWhileRevalidate(req));\n    return;\n  }",
    );
}

function contentType(p) {
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".html") || p === "/") return "text/html; charset=utf-8";
  return "application/octet-stream";
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const p = url.pathname;
  let body;
  if (p === "/" || p === "/index.html") {
    body = shellHtml(generation === "old" ? OLD_SHA : NEW_SHA);
  } else if (p === "/sw.js") {
    body = swFor(generation);
  } else if (p === "/pwa-offline.js") {
    body = REAL_OFFLINE;
  } else if (p === "/messages-composer.js") {
    body = composerFor(generation);
  } else {
    res.writeHead(404);
    res.end("missing");
    return;
  }
  res.writeHead(200, {
    "Content-Type": contentType(p),
    "Cache-Control": "no-store",
  });
  res.end(body);
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readState(page) {
  return page.evaluate(async () => {
    const cacheKeys = await caches.keys();
    return {
      sha: document.getElementById("sha")?.textContent || "",
      composerMark: window.__COMPOSER_MARK__ || "",
      composerSha: window.__COMPOSER_SHA__ || "",
      cacheKeys,
      controller: navigator.serviceWorker.controller?.scriptURL || "",
    };
  });
}

async function main() {
  fs.mkdirSync(ART, { recursive: true });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const log = [];
  const note = (m) => { log.push(m); console.log(m); };

  note("generation=old → load + register SW");
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
  // Let precache settle.
  await sleep(800);
  const oldState = await readState(page);
  note("oldState=" + JSON.stringify(oldState));
  if (oldState.sha !== OLD_SHA) throw new Error("old sha mismatch: " + oldState.sha);
  if (!oldState.cacheKeys.includes("tinker-shell-v12")) {
    throw new Error("expected v12 cache after old install, got " + oldState.cacheKeys.join(","));
  }
  if (oldState.composerMark !== "COMPOSER_OLD_V12") {
    throw new Error("old composer mark missing");
  }

  note("flip origin to generation=new (simulates deploy)");
  generation = "new";

  // Kick update; controllerchange reload may destroy this context mid-flight.
  const reloadPromise = page.waitForNavigation({ waitUntil: "networkidle", timeout: 20000 }).catch(() => null);
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) throw new Error("no registration");
    await reg.update();
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      const w = reg.waiting || reg.installing;
      if (w) {
        w.postMessage({ type: "SKIP_WAITING" });
        return { kicked: true, state: w.state };
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return { kicked: false };
  }).catch((err) => {
    // Navigation from controllerchange often aborts evaluate — expected.
    note("evaluate aborted (likely controllerchange reload): " + String(err.message || err));
    return { kicked: "aborted" };
  });
  await reloadPromise;
  await sleep(500);

  // Explicit next open under the new controller (the "next open" the owner gets).
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 });
  await sleep(500);
  const newState = await readState(page);
  note("newState=" + JSON.stringify(newState));

  const ok =
    newState.sha === NEW_SHA &&
    newState.composerMark === "COMPOSER_NEW_V13" &&
    newState.composerSha === NEW_SHA &&
    newState.cacheKeys.includes("tinker-shell-v13") &&
    !newState.cacheKeys.includes("tinker-shell-v12");

  await page.screenshot({ path: path.join(ART, "sw-update-proof.png"), fullPage: true });
  const result = { ok, oldState, newState, log, OLD_SHA, NEW_SHA };
  fs.writeFileSync(path.join(ART, "sw-update-proof.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(ART, "sw-update-proof.log"), log.join("\n") + "\n");
  note(ok ? "PASS: new sha picked up without manual cache clear" : "FAIL: new sha not picked up");

  await browser.close();
  server.close();
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  try {
    fs.writeFileSync(path.join(ART, "sw-update-proof.log"), String(err && err.stack || err));
  } catch {}
  process.exit(1);
});
