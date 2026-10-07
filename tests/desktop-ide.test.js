/* Desktop IDE workspace contract for /repo write layout.
 *
 * Wide viewports get an exercise file explorer + tabs + essays rail.
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
const ui = fs.readFileSync(path.join(root, "src/renderer/repo/exercise-workspace-ui.js"), "utf8");
const mainJs = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");

test("desktop IDE shell markup is present on /repo write page", () => {
  assert.match(html, /id="repo-explorer"/);
  assert.match(html, /id="repo-explorer-body"/);
  assert.match(html, /id="repo-explorer-collapse"/);
  assert.match(html, /id="repo-explorer-expand"/);
  assert.match(html, /id="repo-tabs"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /id="repo-code"/);
  assert.match(html, /id="repo-ide-center"/);
  assert.match(html, /class="repo-right"/);
  assert.match(html, /id="repo-labs-link"/);
  assert.match(html, /Exercises/);
  assert.doesNotMatch(html, /id="repo-panel"/);
  assert.doesNotMatch(html, /\u2014|\u2013/);
  assert.match(html, /src="\/exercises\/manifest\.js/);
  assert.match(html, /exercise-workspace-ui\.js/);
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
  assert.match(css, /\.repo-code\s*\{/);
  assert.match(css, /\.repo-ex-node\s*\{/);
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
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*\.repo-code[\s\S]*display:\s*none\s*!important/,
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

test("desktop IDE JS boots exercise workspace UI", () => {
  assert.match(page, /tinkerExerciseWorkspaceUi/);
  assert.match(page, /openEssayTab/);
  assert.match(ui, /openFile/);
  assert.match(ui, /moveNode|move_node/);
  assert.match(ui, /createNode|create_node/);
  assert.match(ui, /delete_node/);
  assert.match(ui, /draggable/);
  assert.doesNotMatch(page, /renderPanelChrome/);
  assert.doesNotMatch(html, /No in-app runner/);
});

test("Electron desktop app still loads the same production /repo web UI", () => {
  assert.match(mainJs, /tinker\.beginner\.work/);
  assert.match(mainJs, /\/repo/);
  assert.match(mainJs, /loadURL\(/);
  assert.doesNotMatch(mainJs, /loadFile\(/);
});

test("location pill stays hidden while the exercise code editor is open", () => {
  assert.match(css, /\.repo-location\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
  assert.match(ui, /els\.location\)\s*els\.location\.hidden\s*=\s*!show/);
});

test("exercise code editor is an invisible writing surface with syntax highlight", () => {
  assert.match(html, /id="repo-code-editor"/);
  assert.match(html, /class="writing-input repo-code__editor"/);
  assert.match(html, /id="repo-code-highlight"/);
  assert.match(html, /\/lib\/repo-code-highlight\.js/);
  assert.match(html, /prism-languages\.min\.js/);
  assert.match(css, /\.repo-code__editor\s*\{[^}]*border:\s*0/s);
  assert.match(css, /\.repo-code__editor\s*\{[^}]*background:\s*transparent/s);
  assert.match(css, /\.repo-code__editor\s*\{[^}]*color:\s*transparent/s);
  assert.match(css, /\.repo-code--prose/);
  assert.match(css, /\.repo-code__highlight \.token\.keyword/);
  assert.match(ui, /syncHighlight|tinkerRepoCodeHighlight/);
  assert.match(ui, /isProseFile/);
  assert.doesNotMatch(css, /\.repo-code__editor\s*\{[^}]*border:\s*1px solid/s);
});

test("macOS Dock keeps the bundled icon mask (no runtime square override)", () => {
  const iconInit = fs.readFileSync(path.join(root, "src/renderer/icon-init.js"), "utf8");
  assert.match(iconInit, /platform === ["']darwin["']/);
  assert.match(iconInit, /return;/);
  assert.doesNotMatch(mainJs, /app\.dock\.setIcon/);
  assert.match(mainJs, /process\.platform === ["']darwin["'][\s\S]*return true/);
});
