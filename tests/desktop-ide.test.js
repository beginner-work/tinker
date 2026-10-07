/* Desktop IDE workspace contract for /repo write layout.
 *
 * Wide viewports get explorer + tabs + essays rail + bottom output panel.
 * Mobile (≤800px) keeps the prior single-column pad (no IDE chrome).
 * Electron loads the same production web UI, so /repo changes apply there.
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

test("desktop IDE shell markup is present on /repo write page", () => {
  assert.match(html, /id="repo-explorer"/);
  assert.match(html, /id="repo-explorer-body"/);
  assert.match(html, /id="repo-explorer-collapse"/);
  assert.match(html, /id="repo-explorer-expand"/);
  assert.match(html, /id="repo-tabs"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /id="repo-panel"/);
  assert.match(html, /id="repo-panel-toggle"/);
  assert.match(html, /id="repo-panel-empty"/);
  assert.match(html, /id="repo-exercise-view"/);
  assert.match(html, /id="repo-ide-center"/);
  assert.match(html, /class="repo-right"/);
  assert.match(html, /id="repo-labs-link"/);
  assert.match(html, /No in-app runner yet/);
  assert.doesNotMatch(html, /\u2014|\u2013/);
  assert.match(html, /src="\/exercises\/manifest\.js/);
  assert.doesNotMatch(html, /src="\/exercises\/exercises-open\.js/);
});

test("desktop IDE CSS is gated; mobile hides IDE chrome", () => {
  assert.match(css, /--repo-explorer-rail:\s*240px/);
  assert.match(
    css,
    /\.repo-layout--write\s*\{[^}]*var\(--repo-explorer-rail/s,
  );
  assert.match(
    css,
    /\.repo-layout--write\s*\{[^}]*minmax\(\s*260px,\s*var\(--repo-essays-rail(?:,\s*320px)?\)/s,
  );
  assert.match(css, /\.repo-tabs\s*\{/);
  assert.match(css, /\.repo-explorer\s*\{/);
  assert.match(css, /\.repo-panel\s*\{/);
  assert.match(css, /box-shadow:\s*inset 0 -2px 0 var\(--color-accent-strong/);
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*\.repo-explorer[\s\S]*display:\s*none\s*!important/,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*\.repo-tabs[\s\S]*display:\s*none\s*!important/,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*\.repo-panel[\s\S]*display:\s*none\s*!important/,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*\.repo-ide-center\s*\{[^}]*display:\s*contents/,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*body\.repo-page--write\s+\.repo-right\s*\{[^}]*display:\s*none/s,
  );
});

test("desktop IDE JS reuses locations, tabs, and empty output panel", () => {
  assert.match(page, /openEssayTab/);
  assert.match(page, /openExerciseTab/);
  assert.match(page, /closeTab/);
  assert.match(page, /renderExplorer/);
  assert.match(page, /renderTabs/);
  assert.match(page, /renderPanelChrome/);
  assert.match(page, /removeSuggestedPlace/);
  assert.match(page, /repo-explorer__remove/);
  assert.match(page, /PLACE_STARTERS/);
  assert.match(page, /tinkerExercisesManifest/);
  assert.match(page, /No in-app runner/);
  assert.match(page, /getOpenTabs/);
  // UI copy for the empty panel must not use em/en dashes (CI copy rule).
  const emptyCopy = (page.match(/No in-app runner[^"`]{0,160}/) || [""])[0];
  assert.doesNotMatch(emptyCopy, /\u2014|\u2013/);
});

test("Electron desktop app still loads the same production /repo web UI", () => {
  assert.match(mainJs, /tinker\.beginner\.work/);
  assert.match(mainJs, /\/repo/);
  assert.match(mainJs, /loadURL\(/);
  assert.doesNotMatch(mainJs, /loadFile\(/);
});
