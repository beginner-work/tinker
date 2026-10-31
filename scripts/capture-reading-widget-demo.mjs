#!/usr/bin/env node
/* Capture reading-widget demo screenshots + short interaction evidence. */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = "/opt/cursor/artifacts";
const SIERRA_URL =
  process.env.READING_DEMO_ARTICLE_URL ||
  "https://sierra.ai/blog/gardening-week-evergreen-engineering";
const BASE =
  process.env.READING_DEMO_URL ||
  "http://127.0.0.1:8791/reading-widget/?url=" + encodeURIComponent(SIERRA_URL);

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector(".rw-brand");
await page.waitForTimeout(600);
await page.screenshot({
  path: path.join(OUT, "reading-widget-ready.png"),
  fullPage: true,
});

await page.click("[data-rw-play]");
await page.waitForTimeout(800);
await page.screenshot({
  path: path.join(OUT, "reading-widget-listening.png"),
  fullPage: true,
});

await page.click("[data-rw-interrupt]");
await page.fill(
  "[data-rw-question]",
  "What is Gardening Week at Sierra, according to this post?",
);
await page.screenshot({
  path: path.join(OUT, "reading-widget-interrupt.png"),
  fullPage: true,
});

await page.click("[data-rw-ask-send]");
await page.waitForSelector(".rw-answer.is-on");
await page.waitForTimeout(500);
await page.screenshot({
  path: path.join(OUT, "reading-widget-answered.png"),
  fullPage: true,
});

const answer = await page.textContent("[data-rw-answer-text]");
fs.writeFileSync(
  path.join(OUT, "reading-widget-demo-answer.txt"),
  String(answer || "").trim() + "\n",
);

await browser.close();
console.log("Wrote reading-widget demo screenshots to", OUT);
