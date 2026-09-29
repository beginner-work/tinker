/* Story parts page — plain UI for outreach parts (not a pitch deck). */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/story-parts/index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "src/renderer/story-parts/story-parts.js"), "utf8");
const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
const index = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");

test("story-parts page lists and creates parts for the composer", () => {
  assert.match(html, /Story parts/);
  assert.match(html, /id="sp-form"/);
  assert.match(html, /story-parts\.js/);
  assert.match(js, /action:\s*["']list["']|api\(["']GET["'],\s*["']list["']/);
  assert.match(js, /create/);
  assert.match(js, /stageKey/);
  assert.equal(/\bpitch deck\b/i.test(html + js), false);
  assert.equal(/\bTyler\b/.test(html + js), false);
  assert.match(vercel, /\/story-parts/);
  // Story parts lives under Settings now; the inbox rail no longer links it directly.
  const settings = fs.readFileSync(path.join(root, "src/renderer/settings/index.html"), "utf8");
  assert.match(settings, /href="\/story-parts"/);
  assert.equal(/href="\/story-parts"/.test(index), false);
});
