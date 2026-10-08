/* Desktop / mobile parity for /repo write layout.
 *
 * Shared structure: top bar (beaker + hamburger), writing surface,
 * right essays sidebar. Exercises gated by Learning sign-in.
 * Mobile hides editable code; desktop keeps CodeMirror editing.
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
const cmSrc = fs.readFileSync(
  path.join(root, "src/renderer/lib/repo-cm-editor-src.mjs"),
  "utf8",
);

test("shared shell markup: top bar, explorer gate, writing, right essays", () => {
  assert.match(html, /id="repo-explorer"/);
  assert.match(html, /id="repo-explorer-body"/);
  assert.match(html, /id="repo-explorer-signin"/);
  assert.match(html, /id="repo-explorer-gated"/);
  assert.match(html, /id="repo-tabs"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /id="repo-code"/);
  assert.match(html, /id="repo-ide-center"/);
  assert.match(html, /class="repo-right[^"]*repo-essays-sidebar|repo-essays-sidebar[^"]*repo-right/);
  assert.match(html, /id="repo-labs-link"/);
  assert.match(html, /id="repo-ide-tabbar"/);
  assert.match(html, /data-learning-lab/);
  assert.match(html, /data-exercises-nav/);
  assert.match(html, /aria-label="Exercises"/);
  assert.doesNotMatch(html, />\s*Learning Lab\s*</);
  assert.match(html, /id="repo-past-essays"/);
  assert.match(html, /id="repo-panel"/);
  assert.match(html, /id="repo-panel-write"/);
  assert.match(html, /id="repo-panel-close"/);
  assert.match(html, /Exercises/);
  assert.doesNotMatch(html, /\u2014|\u2013/);
  assert.match(html, /src="\/exercises\/manifest\.js/);
  assert.match(html, /exercise-workspace-ui\.js/);
  assert.match(html, /learning-auth\.js/);
  assert.match(html, /exercise-revision\.js/);
  assert.match(ui, /Write about this exercise/);
  assert.match(css, /\.repo-ex-write-about/);
  assert.doesNotMatch(html, /src="\/exercises\/exercises-open\.js/);
});

test("layout CSS: explorer | center | essays rail; mobile hides code editing", () => {
  assert.match(css, /--repo-explorer-rail:\s*280px/);
  assert.match(css, /--repo-essays-rail/);
  assert.match(
    css,
    /\.repo-layout--write\s*\{[^}]*grid-template-columns:\s*auto/s,
  );
  assert.match(
    css,
    /\.repo-layout--write\s*\{[^}]*var\(--repo-essays-rail/s,
  );
  assert.match(
    css,
    /\.repo-explorer\s*\{[^}]*min-width:\s*280px/s,
  );
  assert.match(
    css,
    /\.repo-explorer\s*\{[^}]*width:\s*var\(--repo-explorer-rail/s,
  );
  assert.match(css, /\.repo-layout--write\.is-essays-open/);
  assert.match(css, /\.repo-essays-sidebar/);
  assert.match(css, /\.repo-top--labs\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.repo-top__past-essays\s*\{[^}]*display:\s*inline-flex/s);
  assert.match(css, /\.repo-panel\s*\{/);
  assert.match(css, /\.repo-tabs\s*\{/);
  assert.match(css, /\.repo-explorer\s*\{/);
  assert.match(css, /\.repo-code\s*\{/);
  assert.match(css, /\.repo-ex-node\s*\{/);
  assert.match(css, /box-shadow:\s*inset 0 -2px 0 var\(--color-accent-strong/);
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*\.repo-code[\s\S]*display:\s*none\s*!important/,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*\.repo-tabs[\s\S]*display:\s*none\s*!important/,
  );
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*body\.repo-page--write\s+\.repo-right\s*\{[^}]*display:\s*none/s,
  );
  assert.match(css, /\.repo-explorer-signin/);
});

test("exercises explorer scrolls and stays above the writing panel", () => {
  // Bug 1: gated wrapper is a flex child with min-height:0 so __body can scroll.
  assert.match(
    css,
    /\.repo-explorer__gated\s*\{[^}]*flex:\s*1 1 auto[^}]*min-height:\s*0[^}]*flex-direction:\s*column[^}]*overflow:\s*hidden/s,
  );
  assert.match(
    css,
    /\.repo-explorer__body\s*\{[^}]*overflow-y:\s*auto/s,
  );
  assert.match(
    css,
    /\.repo-explorer__body\s*\{[^}]*-webkit-overflow-scrolling:\s*touch/s,
  );
  // Bug 2: explorer stacks above the writing panel; pad stays in-flow in the center column.
  assert.match(
    css,
    /\.repo-explorer\s*\{[^}]*z-index:\s*20/s,
  );
  assert.match(
    css,
    /\.repo-panel\s*\{[^}]*z-index:\s*1/s,
  );
  assert.match(
    css,
    /\.repo-ide-center\s*\{[^}]*grid-column:\s*2/s,
  );
  assert.match(
    css,
    /\.repo-panel__write \.repo-surface\.writing\s*\{[\s\S]*?position:\s*relative[\s\S]*?left:\s*auto[\s\S]*?\}/,
  );
  assert.match(html, /repo\.css\?v=51/);
  assert.match(html, /id="repo-explorer-scrim"/);
  assert.match(css, /\.repo-explorer-scrim/);
  assert.match(
    css,
    /@media\s*\(max-width:\s*800px\)\s*\{[\s\S]*\.repo-layout--write\.is-explorer-open \.repo-explorer-scrim\s*\{[^}]*display:\s*block/s,
  );
  // Vertical exercise stack: write-about / steps / tree sit under the titled
  // .repo-explorer__group (not orphans above the next exercise, and not inside
  // .repo-ex-node flex rows used for files).
  assert.match(ui, /group\.appendChild\(writeAbout\)/);
  assert.match(ui, /renderStepsPanel\(group,\s*exerciseId\)/);
  assert.match(ui, /group\.appendChild\(list\)/);
  assert.match(ui, /els\.body\.appendChild\(group\)/);
  assert.match(ui, /applyDefaultCollapsed/);
  assert.doesNotMatch(ui, /repo-ex-node[\s\S]{0,80}repo-ex-write-about/);
});

test("desktop IDE JS boots exercise workspace UI + essays sidebar", () => {
  assert.match(page, /tinkerExerciseWorkspaceUi/);
  assert.match(page, /openEssayTab/);
  assert.match(page, /setEssaysSidebar|setMobileEssayList/);
  assert.match(page, /startExerciseEssay/);
  assert.match(ui, /openFile/);
  assert.match(ui, /moveNode|move_node/);
  assert.match(ui, /createNode|create_node/);
  assert.match(ui, /delete_node/);
  assert.match(ui, /draggable/);
  assert.match(ui, /isLearningSignedIn/);
  assert.match(ui, /applyAuthGate/);
  assert.match(ui, /Write about this exercise/);
  assert.doesNotMatch(page, /renderPanelChrome/);
  assert.doesNotMatch(html, /No in-app runner/);
});

test("Electron desktop app still loads the same production /repo web UI", () => {
  assert.match(mainJs, /tinker\.beginner\.work/);
  assert.match(mainJs, /\/repo/);
  assert.match(mainJs, /loadURL\(/);
  assert.doesNotMatch(mainJs, /loadFile\(/);
});

test("writing chrome stays visible; mobile code stays hidden", () => {
  assert.match(css, /\.repo-location\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
  assert.match(css, /\.repo-pad\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
  assert.match(ui, /function showWritingChrome/);
  assert.match(ui, /isWideDesktop/);
  assert.match(ui, /els\.pad\.hidden = false/);
});

test("exercise editor uses CodeMirror with a full-column invisible surface", () => {
  assert.match(html, /id="repo-code-surface"/);
  assert.match(html, /codemirror-repo-editor\.min\.js/);
  assert.match(html, /id="repo-code-editor"[^>]*hidden/);
  assert.doesNotMatch(html, /prism-languages/);
  assert.doesNotMatch(html, /repo-code-highlight\.js/);
  assert.match(ui, /tinkerCodeMirror/);
  assert.match(ui, /ensureCm/);
  assert.match(cmSrc, /tinkerLightHighlight|HighlightStyle\.define/);
  assert.match(cmSrc, /markdownLivePreview/);
  assert.match(cmSrc, /lang-yaml|@codemirror\/lang-yaml/);
  assert.match(css, /\.repo-code\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.repo-code__surface\s*\{[^}]*flex:\s*1/s);
  assert.match(css, /body\.repo-code-open[\s\S]*display:\s*none\s*!important/);
  assert.match(css, /\.repo-code__surface \.cm-editor/);
});

test("open-file tabs stay fully visible above the write-safe fade", () => {
  assert.match(
    css,
    /@media\s*\(min-width:\s*801px\)\s*\{[\s\S]*\.repo-ide-tabbar\s*\{[^}]*z-index:\s*14/s,
  );
  assert.match(css, /--repo-tabs-height:\s*40px/);
  assert.match(css, /\.repo-tabs\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /body\.repo-code-open[\s\S]*\.repo-center\.repo-write-safe-top::before[\s\S]*display:\s*none\s*!important/);
  assert.match(css, /\.repo-tabs:not\(\[hidden\]\)[\s\S]*\.repo-center\.repo-write-safe-top::before[\s\S]*top:\s*var\(--repo-tabs-height/);
  assert.match(css, /html\[data-tinker-desktop\][\s\S]*\.repo-top--labs[\s\S]*traffic-inset/);
  assert.match(css, /\.repo-tabs__close\s*\{[^}]*flex-shrink:\s*0/s);
});

test("macOS Dock keeps the bundled icon mask (no runtime square override)", () => {
  const iconInit = fs.readFileSync(path.join(root, "src/renderer/icon-init.js"), "utf8");
  assert.match(iconInit, /platform === ["']darwin["']/);
  assert.match(iconInit, /return;/);
  assert.doesNotMatch(mainJs, /app\.dock\.setIcon/);
  assert.match(mainJs, /process\.platform === ["']darwin["'][\s\S]*return true/);
});
