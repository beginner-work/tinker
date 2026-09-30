/* Verify Choose folder: desktop picker path + iPhone unsupported UI.
 *
 * STUBBED: no real Google Drive / OAuth. Uses File System Access API when
 * available (Chromium). iPhone path uses a Safari iOS user-agent context.
 *
 * Writes /opt/cursor/artifacts/choose-folder-desktop-fixed.png and
 * choose-folder-iphone-fixed.png
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const ART = "/opt/cursor/artifacts";
const PORT = 4191;

const settingsHtml = fs.readFileSync(path.join(root, "src/renderer/settings/index.html"), "utf8")
  .replace('href="/design-tokens.css"', 'href="/design-tokens.css"')
  .replace('href="/styles.css"', 'href="/styles.css"');

const files = {
  "/settings/": settingsHtml,
  "/settings/index.html": settingsHtml,
  "/design-tokens.css": fs.readFileSync(path.join(root, "src/renderer/design-tokens.css"), "utf8"),
  "/styles.css": fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8"),
  "/auth.js": "window.tinkerAuth = {};",
  "/lib/notes-folder-core.js": fs.readFileSync(path.join(root, "src/renderer/lib/notes-folder-core.js"), "utf8"),
  "/notes-folder.js": fs.readFileSync(path.join(root, "src/renderer/notes-folder.js"), "utf8"),
  "/lead-drafts.js": "/* stub */",
  "/settings/settings.js": "/* stub */",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  const p = url.pathname === "/settings" ? "/settings/" : url.pathname;
  if (files[p]) {
    const type = p.endsWith(".css")
      ? "text/css"
      : p.endsWith(".js")
        ? "application/javascript"
        : "text/html";
    res.writeHead(200, { "Content-Type": type + "; charset=utf-8", "Cache-Control": "no-store" });
    res.end(files[p]);
    return;
  }
  res.writeHead(404);
  res.end("missing " + p);
});

async function shot(browser, opts) {
  const context = await browser.newContext(opts.context);
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/settings/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!(window.tinkerNotesFolder && window.tinkerNotesFolderCore));
  const capability = await page.evaluate(() => window.tinkerNotesFolder.capability());
  const actionsHidden = await page.evaluate(() => {
    const el = document.querySelector("[data-notes-folder-actions]");
    return !el || el.hidden === true;
  });
  const unsupportedVisible = await page.evaluate(() => {
    const el = document.querySelector("[data-notes-folder-unsupported]");
    return !!(el && el.hidden === false && String(el.textContent || "").trim());
  });
  const unsupportedText = await page.evaluate(() => {
    const el = document.querySelector("[data-notes-folder-unsupported]");
    return el ? String(el.textContent || "").trim() : "";
  });
  const pickVisible = await page.evaluate(() => {
    const el = document.querySelector("[data-notes-folder-pick]");
    const row = document.querySelector("[data-notes-folder-actions]");
    if (!el || !row) return false;
    if (row.hidden) return false;
    var style = window.getComputedStyle(row);
    if (style.display === "none" || style.visibility === "hidden") return false;
    return el.getClientRects().length > 0;
  });
  await page.locator("[data-notes-folder]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: opts.shot, fullPage: true });
  await context.close();
  return { capability, actionsHidden, unsupportedVisible, unsupportedText, pickVisible };
}

async function main() {
  fs.mkdirSync(ART, { recursive: true });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const browser = await chromium.launch();
  const desktop = await shot(browser, {
    context: { viewport: { width: 1280, height: 800 } },
    shot: path.join(ART, "choose-folder-desktop-fixed.png"),
  });
  const iphone = await shot(browser, {
    context: {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    },
    shot: path.join(ART, "choose-folder-iphone-fixed.png"),
  });
  await browser.close();
  server.close();

  const report = {
    stubbed: [
      "No Google Picker / Drive OAuth (feature is local File System Access API / Electron dialog)",
      "auth.js / lead-drafts.js / settings.js stubbed",
      "Directory picker dialog itself not asserted (OS UI)",
    ],
    desktop,
    iphone,
    ok: desktop.capability === "fs-access"
      && desktop.pickVisible === true
      && iphone.capability === "unsupported"
      && iphone.actionsHidden === true
      && iphone.unsupportedVisible === true
      && /iPhone/i.test(iphone.unsupportedText),
  };
  fs.writeFileSync(path.join(ART, "choose-folder-verify.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
