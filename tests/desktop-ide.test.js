/* Desktop / mobile parity for /repo write layout.
 *
 * Shared structure: top bar (Technical essays mark + Essays hamburger),
 * writing surface, left Technical essays list, right Essays list.
 * Mobile first screen stays essay writing.
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/repo/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/repo/repo.css"), "utf8");
const page = fs.readFileSync(path.join(root, "src/renderer/repo/repo.js"), "utf8");
const mainJs = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");

test("shared shell markup: mark, writing, dual essay lists", () => {
  assert.match(html, /id="repo-left"/);
  assert.match(html, /repo-tech-essays-sidebar/);
  assert.match(html, /id="repo-tech-tree"/);
  assert.match(html, /id="repo-ide-center"/);
  assert.match(html, /class="repo-right[^"]*repo-essays-sidebar|repo-essays-sidebar[^"]*repo-right/);
  assert.match(html, /id="repo-labs-link"/);
  assert.match(html, /data-technical-essays-nav/);
  assert.match(html, /aria-label="Technical essays"/);
  assert.match(html, /id="repo-past-essays"/);
  assert.match(html, /id="repo-panel"/);
  assert.match(html, /id="repo-panel-write"/);
  assert.doesNotMatch(html, /id="repo-panel-close"/);
  assert.doesNotMatch(html, /\u2014|\u2013/);
  assert.doesNotMatch(html, /id="repo-explorer"/);
  assert.doesNotMatch(html, /id="repo-learning-prompt"/);
  assert.doesNotMatch(html, /exercise-workspace-ui\.js/);
  assert.doesNotMatch(html, /learning-auth\.js/);
  assert.doesNotMatch(html, /repo-layout--learning/);
  assert.doesNotMatch(html, />\s*Learning Lab\s*</);
  assert.doesNotMatch(html, /src="\/exercises\/manifest\.js/);
});

test("layout CSS: technical essays | center | essays rail", () => {
  assert.match(css, /--repo-tech-essays-rail/);
  assert.match(css, /--repo-essays-rail/);
  assert.match(
    css,
    /\.repo-layout--write\s*\{[^}]*var\(--repo-tech-essays-rail/s,
  );
  assert.match(
    css,
    /\.repo-layout--write\s*\{[^}]*var\(--repo-essays-rail/s,
  );
  assert.match(css, /\.repo-layout--write\.is-tech-essays-open/);
  assert.match(css, /\.repo-layout--write\.is-essays-open/);
  assert.match(css, /\.repo-tech-essays-sidebar/);
  assert.match(css, /\.repo-essays-sidebar/);
  assert.match(css, /\.repo-top--labs\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.repo-top__past-essays\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(css, /\.repo-panel\s*\{/);
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*body\.repo-page--write\s+\.repo-right\s*\{[^}]*display:\s*none/s,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*body\.repo-page--write\s+\.repo-left\s*\{[^}]*display:\s*none/s,
  );
});

test("write page loads Technical essays chrome without learning loop", () => {
  assert.match(html, /repo\.css\?v=64/);
  assert.match(html, /Technical essays/);
  assert.doesNotMatch(html, /repo-layout--learning/);
  assert.doesNotMatch(html, /id="repo-code"/);
  assert.doesNotMatch(html, /id="repo-learning-zpd"/);
});

test("desktop write JS boots dual essay sidebars", () => {
  assert.match(page, /toggleTechnicalEssays/);
  assert.match(page, /setTechnicalEssayList/);
  assert.match(page, /setEssaysSidebar|setMobileEssayList/);
  assert.match(page, /activeListKind/);
  assert.match(page, /filesForList/);
  assert.doesNotMatch(page, /tinkerExerciseWorkspaceUi\.init/);
  assert.match(mainJs, /BrowserWindow|webPreferences/);
});
