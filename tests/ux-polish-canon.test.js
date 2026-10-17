/* UI-contract: /repo uses design-system close/back/focus patterns. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/repo/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/repo/repo.css"), "utf8");
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
  // Write page no longer ships explorer/chip close chrome; icons stay in JS helpers.
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

test("panels stay flat; focus uses --focus-ring; foot morph is gated compose motion", () => {
  assert.match(css, /\.repo-pad-error\s*\{[\s\S]*?box-shadow:\s*none/s);
  assert.match(css, /\.repo-surface__action:focus-visible\s*\{[^}]*var\(--focus-ring\)/s);
  assert.match(css, /\.repo-top__labs:focus-visible\s*\{[^}]*var\(--focus-ring\)/s);
  // Shared-element FAB ↔ island morph only (width/radius/opacity via --repo-compose-morph-ms).
  assert.match(css, /--repo-compose-morph-ms:\s*300ms/);
  assert.match(css, /\.repo-surface__foot\s*\{[^}]*transition:[\s\S]*?width/s);
  assert.match(
    css,
    /prefers-reduced-motion:\s*reduce[\s\S]*?\.repo-surface__foot\s*\{[^}]*transition:\s*opacity/s
  );
  // No decorative product-layer keyframes.
  assert.doesNotMatch(css, /@keyframes\s+labs-drawer-slide-in/);
});

test("UI copy avoids free/real/quietly and em dashes on /repo shell", () => {
  assert.doesNotMatch(html, /\u2014|\u2013/);
  assert.doesNotMatch(html, /\bfree\b/i);
  assert.doesNotMatch(html, /\bquietly\b/i);
  // "real" appears in comments sometimes; ban only in visible button labels.
  assert.doesNotMatch(html, />[^<]*\breal\b[^<]*</i);
});
