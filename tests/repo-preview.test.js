/* UI-contract smoke test for the /repo repository preview skeleton.
 *
 * Structural only — sample fixtures, no API/storage/git wiring.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/repo/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/repo/repo.css"), "utf8");
const page = fs.readFileSync(path.join(root, "src/renderer/repo/repo.js"), "utf8");
const fixturesSrc = fs.readFileSync(path.join(root, "src/renderer/repo/fixtures.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
const settings = fs.readFileSync(path.join(root, "src/renderer/settings/index.html"), "utf8");
const mainJs = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");

test("repo preview page renders the three-pane skeleton markup", () => {
  assert.match(html, /Repository preview/);
  assert.match(html, /id="repo-reflections-list"/);
  assert.match(html, /id="repo-tree"/);
  assert.match(html, /id="repo-new-piece"/);
  assert.match(html, /id="repo-editor"/);
  assert.match(html, /id="repo-reflection-pane"/);
  assert.match(html, /Develop into the repository/);
  assert.match(html, /id="repo-changes-list"/);
  assert.match(html, /id="repo-save-version"/);
  assert.match(html, /id="repo-history-list"/);
  assert.match(html, /id="repo-mobile"/);
  assert.match(html, /class="writing-input"/);
  assert.match(html, /class="writing-question"/);
  assert.match(html, /src="\/repo\/fixtures\.js"/);
  assert.match(html, /src="\/repo\/repo\.js"/);
  assert.equal(html.includes("innerHTML"), false);
  assert.equal(page.includes("innerHTML"), false);
  assert.doesNotMatch(html, /Tyler|tlindow|nanoengineering/i);
  assert.doesNotMatch(page, /Tyler|tlindow|nanoengineering/i);
  assert.doesNotMatch(fixturesSrc, /Tyler|tlindow|nanoengineering/i);
});

test("repo fixtures expose sample reflections, folders, and history", () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fixturesSrc, vm.createContext(sandbox));
  const sample = sandbox.window.tinkerRepoFixtures.SAMPLE_REPO;
  assert.ok(sample.name);
  assert.ok(sample.branchLabel);
  assert.ok(Array.isArray(sample.reflections));
  assert.ok(sample.reflections.length >= 2);
  assert.ok(Array.isArray(sample.folders));
  assert.ok(sample.folders.length >= 2);
  assert.ok(sample.folders[0].pieces.length >= 1);
  assert.ok(Array.isArray(sample.history));
  assert.ok(sample.history.length >= 1);
  assert.match(sample.reflections[0].title, /Sample/);
});

test("repo preview routes and desktop entry are wired", () => {
  assert.match(vercel, /\/repo\/index\.html/);
  assert.match(sw, /pathname === "\/repo"/);
  assert.match(settings, /href="\/repo"/);
  assert.match(settings, /Repository preview/);
  assert.match(mainJs, /label:\s*"Repository preview"/);
  assert.match(mainJs, /\/repo/);
  assert.match(css, /\.repo-layout/);
  assert.match(css, /\.repo-reflections/);
});

test("repo page stays UI-only — no API or persistence hooks", () => {
  assert.doesNotMatch(page, /fetch\s*\(/);
  assert.doesNotMatch(page, /localStorage|indexedDB|prisma/i);
  assert.doesNotMatch(fixturesSrc, /fetch\s*\(|localStorage|prisma/i);
  assert.match(page, /developReflection/);
  assert.match(page, /saveHint/);
  assert.match(html, /Not wired yet/);
});
