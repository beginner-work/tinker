/* UI-contract regression guard for the Cursor-mobile-shaped workspace.
 *
 * Pitch sections must live in the main workspace column (not the
 * sidebar drawer). The sidebar hosts the pitches/agents list. Cold-start
 * still keeps the welcome place grid. Styling stays on tinker tokens.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RENDERER = path.join(__dirname, "..", "src", "renderer");
const html = fs.readFileSync(path.join(RENDERER, "index.html"), "utf8");
const treeJs = fs.readFileSync(path.join(RENDERER, "sidebar-tree.js"), "utf8");
const styles = fs.readFileSync(path.join(RENDERER, "styles.css"), "utf8");

test("workspace hosts the pitch deck sections", () => {
  assert.match(html, /id="workspace"/, "#workspace mount is missing");
  assert.match(html, /class="workspace__deck sidebar__tree"/, "workspace deck is missing");
  assert.match(html, /class="sidebar__tree-list workspace__section-list"/,
    "workspace section list is missing");
  // Progress chrome travels with the deck into the workspace.
  assert.match(html, /data-tree-progress/, "pitch progress bar is missing from workspace");
});

test("sidebar hosts the pitches agents list, not the deck sections", () => {
  assert.match(html, /class="sidebar__agents"/, "sidebar agents nav is missing");
  assert.match(html, /data-pitch-switcher/, "pitch switcher mount is missing");
  // Extract the sidebar aside and confirm the deck tree isn't inside it.
  const asideMatch = html.match(/<aside\b[^>]*class="sidebar"[^>]*>[\s\S]*?<\/aside>/);
  assert.ok(asideMatch, "sidebar aside is missing");
  assert.doesNotMatch(
    asideMatch[0],
    /class="[^"]*sidebar__tree/,
    "pitch deck tree must not live inside the sidebar aside"
  );
  assert.match(
    asideMatch[0],
    /sidebar__agents/,
    "agents list must live inside the sidebar aside"
  );
});

test("cold-start welcome grid is preserved beside the workspace", () => {
  assert.match(html, /data-welcome-cold/, "cold-start welcome mount is missing");
  assert.match(html, /id="welcome-grid"/, "welcome-grid must remain for cold start");
});

test("sidebar-tree mounts deck into workspace and pitches into sidebar", () => {
  assert.match(treeJs, /workspace__deck/, "sidebar-tree.js no longer targets workspace deck");
  assert.match(treeJs, /sidebar__agents/, "sidebar-tree.js no longer targets agents list");
  assert.match(treeJs, /syncWorkspaceChrome/, "workspace chrome sync is missing");
  assert.match(treeJs, /sidebar__pitch-menu--agents/, "agents-style pitch list is missing");
});

test("workspace styles keep tinker tokens (no Cursor dark shell)", () => {
  assert.match(styles, /\.workspace\s*\{/, "workspace styles missing");
  assert.match(styles, /var\(--color-background\)/, "tinker background token still required");
  assert.match(styles, /var\(--font-display\)/, "Fraunces display token still required");
  assert.doesNotMatch(
    styles,
    /\.workspace[^{]*\{[^}]*#0d1117/,
    "workspace must not use Cursor/GitHub dark background"
  );
});
