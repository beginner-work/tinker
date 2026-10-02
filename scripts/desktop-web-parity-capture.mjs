#!/usr/bin/env node
/**
 * Capture Owner inbox fixture at matching sizes in Chrome (web) vs
 * Chromium-with-desktop-chrome (simulating Electron insertCSS + marker),
 * plus a real Electron BrowserWindow pass via CDP.
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);
const electronPath = require("electron");

const ART = "/opt/cursor/artifacts";
const FIXTURE = "/messages/demo-owner-parity.html";
const SIZES = [
  { name: "1024x640", width: 1024, height: 640 },
  { name: "1440x900", width: 1440, height: 900 },
];

// Mirror current main.js DESKTOP_CHROME_CSS (before fix) for baseline, or
// pass DESKTOP_CSS_FILE to override after edits.
function loadDesktopCss() {
  if (process.env.DESKTOP_CSS_FILE && fs.existsSync(process.env.DESKTOP_CSS_FILE)) {
    return fs.readFileSync(process.env.DESKTOP_CSS_FILE, "utf8");
  }
  const mainJs = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");
  const m = mainJs.match(/const DESKTOP_CHROME_CSS = `([\s\S]*?)`;/);
  if (!m) throw new Error("DESKTOP_CHROME_CSS not found in main.js");
  return m[1];
}

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

async function collectMetrics(page) {
  return page.evaluate(() => {
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    };
    const root = document.documentElement;
    const sidebarTop = document.querySelector(".sidebar__top");
    const brand = document.querySelector(".sidebar__brand");
    const youAvatar = document.querySelector(
      "[data-messages-you-slot] .messages-rail__avatar, [data-messages-you-slot] .messages-rail__logo"
    );
    const paneTop = document.querySelector(".messages-pane__top");
    const paneAvatar = document.querySelector("[data-messages-avatar]");
    const settings = document.querySelector(".messages-rail__settings");
    const settingsIcon = document.querySelector(".messages-rail__settings-icon");
    const sidebar = document.querySelector(".sidebar");
    const name = document.querySelector("[data-messages-name]");
    return {
      ua: navigator.userAgent,
      desktopAttr: root.getAttribute("data-tinker-desktop"),
      desktopClass: root.classList.contains("tinker-desktop"),
      onWeb: root.classList.contains("on-web"),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      sidebarWidth: sidebar ? Math.round(sidebar.getBoundingClientRect().width) : null,
      sidebarTopPadding: sidebarTop
        ? {
            top: cs(sidebarTop).paddingTop,
            left: cs(sidebarTop).paddingLeft,
            right: cs(sidebarTop).paddingRight,
            bottom: cs(sidebarTop).paddingBottom,
          }
        : null,
      brandRect: rect(brand),
      youAvatarText: youAvatar ? youAvatar.textContent.trim() : null,
      youAvatarClass: youAvatar ? youAvatar.className : null,
      youAvatarStyle: youAvatar
        ? {
            color: cs(youAvatar).color,
            background: cs(youAvatar).backgroundColor,
            fontSize: cs(youAvatar).fontSize,
            width: cs(youAvatar).width,
            height: cs(youAvatar).height,
          }
        : null,
      paneTopPadding: paneTop
        ? {
            top: cs(paneTop).paddingTop,
            left: cs(paneTop).paddingLeft,
            right: cs(paneTop).paddingRight,
            bottom: cs(paneTop).paddingBottom,
          }
        : null,
      paneName: name ? name.textContent : null,
      paneAvatarText: paneAvatar ? paneAvatar.textContent.trim() : null,
      paneAvatarHidden: paneAvatar ? !!paneAvatar.hidden : null,
      settingsFont: settings
        ? {
            size: cs(settings).fontSize,
            weight: cs(settings).fontWeight,
            color: cs(settings).color,
            padding: cs(settings).padding,
          }
        : null,
      settingsIcon: settingsIcon
        ? { w: cs(settingsIcon).width, h: cs(settingsIcon).height }
        : null,
    };
  });
}

async function captureWeb(base, size) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
  });
  await page.goto(base + FIXTURE, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(300);
  const metrics = await collectMetrics(page);
  const shot = path.join(ART, `parity-web-${size.name}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  await browser.close();
  return { metrics, shot };
}

async function captureDesktopSim(base, size, desktopCss) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
  });
  await page.goto(base + FIXTURE, { waitUntil: "networkidle", timeout: 30000 });
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-tinker-desktop", "1");
    document.documentElement.classList.add("tinker-desktop");
  });
  await page.addStyleTag({ content: desktopCss });
  await page.waitForTimeout(200);
  const metrics = await collectMetrics(page);
  const shot = path.join(ART, `parity-desktop-${size.name}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  await browser.close();
  return { metrics, shot };
}

async function captureElectron(base, size) {
  const debugPort = 9300 + Math.floor(Math.random() * 200);
  const userData = fs.mkdtempSync("/tmp/tinker-elex-");
  const child = spawn(
    electronPath,
    [
      ".",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userData}`,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        TINKER_DESKTOP_URL: base + FIXTURE,
        ELECTRON_ENABLE_LOGGING: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += String(d);
  });

  let browser;
  for (let i = 0; i < 50; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (!browser) {
    child.kill("SIGKILL");
    throw new Error("Electron CDP failed: " + stderr.slice(-800));
  }

  const context = browser.contexts()[0];
  let page = context.pages()[0];
  for (let i = 0; i < 40 && (!page || !page.url().includes("demo-owner")); i++) {
    await new Promise((r) => setTimeout(r, 200));
    page = context.pages()[0];
  }
  if (!page) {
    child.kill("SIGKILL");
    throw new Error("No Electron page");
  }

  // Best-effort window size (CDP Browser.* is unavailable in some Electron builds).
  try {
    await page.setViewportSize({ width: size.width, height: size.height });
  } catch { /* ignore */ }

  await page.waitForSelector(".messages-rail__settings", { timeout: 15000 });
  await page.waitForTimeout(400);
  const metrics = await collectMetrics(page);
  const shot = path.join(ART, `parity-electron-${size.name}.png`);
  await page.screenshot({ path: shot, fullPage: false });

  try {
    await browser.close();
  } catch {
    /* ignore */
  }
  try {
    child.kill("SIGKILL");
  } catch {
    /* ignore */
  }
  fs.rmSync(userData, { recursive: true, force: true });
  return { metrics, shot };
}

function sideBySide(a, b, out, labelA, labelB) {
  const labeledA = out + ".a.png";
  const labeledB = out + ".b.png";
  // Use ffmpeg or python pillow
  const py = `
from PIL import Image, ImageDraw, ImageFont
import sys
a=Image.open(sys.argv[1]).convert('RGB')
b=Image.open(sys.argv[2]).convert('RGB')
pad, label_h = 16, 28
w=a.width+b.width+pad*3
h=max(a.height,b.height)+pad*2+label_h
canvas=Image.new('RGB',(w,h),(232,228,220))
draw=ImageDraw.Draw(canvas)
draw.text((pad,8), sys.argv[4], fill=(45,42,38))
draw.text((pad*2+a.width,8), sys.argv[5], fill=(45,42,38))
canvas.paste(a,(pad,pad+label_h))
canvas.paste(b,(pad*2+a.width,pad+label_h))
canvas.save(sys.argv[3])
`;
  const script = "/tmp/sbs_parity.py";
  fs.writeFileSync(script, py);
  const r = spawnSync(
    "python3",
    [script, a, b, out, labelA, labelB],
    { encoding: "utf8" }
  );
  if (r.status !== 0) {
    console.warn("sideBySide failed", r.stderr || r.stdout);
    fs.copyFileSync(a, labeledA);
    fs.copyFileSync(b, labeledB);
  }
}

function summarizeDiff(web, desk) {
  const fields = [
    "sidebarWidth",
    "sidebarTopPadding",
    "brandRect",
    "youAvatarText",
    "youAvatarStyle",
    "paneTopPadding",
    "paneAvatarText",
    "settingsFont",
    "settingsIcon",
  ];
  const out = {};
  for (const f of fields) {
    const same = JSON.stringify(web[f]) === JSON.stringify(desk[f]);
    out[f] = { same, web: web[f], desktop: desk[f] };
  }
  // Allowed: left inset on sidebar only
  const webLeft = web.sidebarTopPadding && web.sidebarTopPadding.left;
  const deskLeft = desk.sidebarTopPadding && desk.sidebarTopPadding.left;
  out._allowed_left_inset = {
    webLeft,
    deskLeft,
    note: "desktop may have larger padding-left for traffic lights",
  };
  return out;
}

async function main() {
  fs.mkdirSync(ART, { recursive: true });
  const desktopCss = loadDesktopCss();
  const { server, base } = await startStaticServer();
  console.log("Serving", base);
  const report = { base, desktopCss, sizes: {} };
  try {
    for (const size of SIZES) {
      console.log("—", size.name, "web");
      const web = await captureWeb(base, size);
      console.log("—", size.name, "desktop-sim");
      const desk = await captureDesktopSim(base, size, desktopCss);
      let electron = null;
      try {
        console.log("—", size.name, "electron");
        electron = await captureElectron(base, size);
      } catch (e) {
        console.warn("electron capture failed:", e.message);
      }
      const sbs = path.join(ART, `parity-sbs-${size.name}.png`);
      sideBySide(web.shot, desk.shot, sbs, "Web (Chrome)", "Desktop chrome CSS");
      if (electron) {
        const sbsE = path.join(ART, `parity-sbs-electron-${size.name}.png`);
        sideBySide(web.shot, electron.shot, sbsE, "Web (Chrome)", "Electron shell");
      }
      report.sizes[size.name] = {
        web: web.metrics,
        desktopSim: desk.metrics,
        electron: electron && electron.metrics,
        diffWebVsDesktopSim: summarizeDiff(web.metrics, desk.metrics),
        diffWebVsElectron: electron
          ? summarizeDiff(web.metrics, electron.metrics)
          : null,
        shots: {
          web: web.shot,
          desktop: desk.shot,
          electron: electron && electron.shot,
          sbs,
        },
      };
      console.log(
        "pad sidebar web/desk",
        web.metrics.sidebarTopPadding,
        desk.metrics.sidebarTopPadding
      );
      console.log(
        "pad pane web/desk",
        web.metrics.paneTopPadding,
        desk.metrics.paneTopPadding
      );
      console.log(
        "avatar web/desk",
        web.metrics.youAvatarText,
        desk.metrics.youAvatarText
      );
    }
  } finally {
    server.close();
  }
  const out = path.join(ART, "parity-report.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log("Wrote", out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
