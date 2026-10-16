/* UI-contract: /repo + /inflight use design-system close/back/focus patterns. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/repo/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/repo/repo.css"), "utf8");
const inflightCss = fs.readFileSync(
  path.join(root, "src/renderer/inflight/inflight.css"),
  "utf8"
);
const inflightHtml = fs.readFileSync(
  path.join(root, "src/renderer/inflight/index.html"),
  "utf8"
);
const repoJs = fs.readFileSync(path.join(root, "src/renderer/repo/repo.js"), "utf8");
const exUi = fs.readFileSync(
  path.join(root, "src/renderer/repo/exercise-workspace-ui.js"),
  "utf8"
);
const madeBy = fs.readFileSync(
  path.join(root, "src/renderer/made-by-lindow-labs.js"),
  "utf8"
);

test("close/back controls use design-system SVG icons, not × or ‹› glyphs", () => {
  assert.match(html, /repo-icon--close/);
  assert.match(html, /repo-icon--chevron/);
  assert.doesNotMatch(html, /repo-panel__close[^>]*>\s*×\s*</);
  assert.doesNotMatch(html, /repo-exercise-chip__clear[^>]*>\s*×\s*</);
  assert.doesNotMatch(html, /repo-explorer__collapse[^>]*>\s*‹\s*</);
  assert.doesNotMatch(html, /repo-explorer__expand[^>]*>\s*›\s*</);
  assert.match(repoJs, /createCloseIcon|repo-icon--close/);
  assert.match(exUi, /createCloseIcon|repo-icon--close/);
  assert.match(madeBy, /repo-icon--close/);
  assert.doesNotMatch(repoJs, /close\.textContent\s*=\s*["']\\u00d7["']/);
  assert.doesNotMatch(exUi, /close\.textContent\s*=\s*["']\\u00d7["']/);
  assert.doesNotMatch(madeBy, /close\.textContent\s*=\s*["']\\u00d7["']/);
  assert.doesNotMatch(repoJs, /close\.innerHTML/);
  assert.doesNotMatch(exUi, /close\.innerHTML/);
});

test("secondary chrome buttons use --radius-button, not ad-hoc 6/8px pills-as-links", () => {
  assert.match(css, /\.repo-explorer__tool\s*\{[^}]*border-radius:\s*var\(--radius-button/s);
  assert.match(css, /\.repo-code__save[\s\S]*?border-radius:\s*var\(--radius-button/s);
  assert.match(css, /\.repo-ex-write-about\s*\{[^}]*border-radius:\s*var\(--radius-button/s);
  assert.match(css, /\.repo-top__nav\s*\{[^}]*border-radius:\s*var\(--radius-button/s);
  assert.match(css, /\.repo-pad-error__retry[\s\S]*?border-radius:\s*var\(--radius-button/s);
  // Writing action island keeps the intentional pill chip (mode-nav family).
  assert.match(css, /\.repo-surface__action\s*\{[^}]*border-radius:\s*999px/s);
});

test("panels stay flat; focus uses --focus-ring; foot has no product motion", () => {
  assert.match(css, /\.repo-pad-error\s*\{[\s\S]*?box-shadow:\s*none/s);
  assert.match(css, /\.repo-surface__action:focus-visible\s*\{[^}]*var\(--focus-ring\)/s);
  assert.match(css, /\.repo-top__labs:focus-visible\s*\{[^}]*var\(--focus-ring\)/s);
  assert.doesNotMatch(
    css,
    /\.repo-surface__foot\s*\{[^}]*transition:\s*opacity/s
  );
  assert.doesNotMatch(css, /@keyframes\s+labs-drawer-slide-in/);
});

test("inflight Write is a secondary button link; no entrance animation", () => {
  assert.match(inflightHtml, /class="inflight__write"/);
  assert.match(inflightCss, /\.inflight__write\s*\{[^}]*border-radius:\s*var\(--radius-button/s);
  assert.match(inflightCss, /\.inflight__write:focus-visible\s*\{[^}]*var\(--focus-ring\)/s);
  assert.doesNotMatch(inflightCss, /@keyframes\s+inflight-row-in/);
  assert.doesNotMatch(inflightCss, /animation:\s*inflight-row-in/);
  assert.doesNotMatch(inflightCss, /transition:\s*width/);
});

test("UI copy avoids free/real/quietly and em dashes on /repo shell", () => {
  assert.doesNotMatch(html, /\u2014|\u2013/);
  assert.doesNotMatch(html, /\bfree\b/i);
  assert.doesNotMatch(html, /\bquietly\b/i);
  // "real" appears in comments sometimes; ban only in visible button labels.
  assert.doesNotMatch(html, />[^<]*\breal\b[^<]*</i);
});
