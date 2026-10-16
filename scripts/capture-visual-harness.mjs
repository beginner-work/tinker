#!/usr/bin/env node
/**
 * Capture harness screenshots for before/after PR evidence.
 * Usage: node scripts/capture-visual-harness.mjs <outdir>
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outdir = process.argv[2] || "/opt/cursor/artifacts/before";
fs.mkdirSync(outdir, { recursive: true });

const SCREENS = [
  { name: "repo-writing", path: "/repo/harness/essay-question-overlap.html" },
  { name: "repo-learning-loop", path: "/repo/harness/learning-loop-after.html" },
  { name: "repo-learning-loop-attempt", path: "/repo/harness/learning-loop-attempt.html" },
  { name: "repo-step-preview", path: "/repo/harness/desktop-step-md-preview.html" },
  { name: "repo-mobile-essay", path: "/repo/harness/mobile-essay-list.html" },
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "iphone", width: 390, height: 844 },
];

function startStaticServer() {
  const renderer = path.join(root, "src/renderer");
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || "/").split("?")[0]);
      if (p === "/") p = "/index.html";
      const file = path.join(renderer, p.replace(/^\//, ""));
      if (!file.startsWith(renderer) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        res.end("missing");
        return;
      }
      const ext = path.extname(file);
      const types = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".json": "application/json",
        ".woff2": "font/woff2",
      };
      res.writeHead(200, {
        "Content-Type": types[ext] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

async function main() {
  const { server, base } = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const vp of VIEWPORTS) {
      for (const screen of SCREENS) {
        const page = await browser.newPage({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: 1,
        });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.addInitScript(() => {
          Date.now = () => new Date("2026-10-15T12:00:00.000Z").getTime();
          // Freeze CSS animations for deterministic captures.
          const style = document.createElement("style");
          style.textContent = `
            *, *::before, *::after {
              animation: none !important;
              transition: none !important;
              caret-color: transparent !important;
            }
          `;
          document.documentElement.appendChild(style);
        });
        await page.goto(base + screen.path, { waitUntil: "networkidle" });
        await page.waitForTimeout(200);
        const file = path.join(outdir, `${screen.name}--${vp.name}.png`);
        await page.screenshot({ path: file, fullPage: false });
        console.log("wrote", file);
        await page.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
