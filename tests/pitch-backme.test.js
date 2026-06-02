/* Publish-button destination contract.
 *
 * The sidebar's bottom-of-nav button used to open the founder's "Back me"
 * page on beginner. tinker is now private, and that button is the one seam
 * where the founder makes writing public: it's labelled "Publish" and, on
 * click, opens the booklet picker (publish-stories.js) so they can choose
 * which pitches to surface and publish the essays behind them to their
 * public profile.
 *
 * (The founder's QR / Back me page still exists — it's reached from the
 * profile menu, which delegates to back-me.js. Only this sidebar button
 * was repurposed.)
 *
 * The renderer is browser-shaped and the existing sidebar-tree sandbox
 * uses a no-op DOM that can't observe events, so this is a source-level
 * contract test: it pins the moving parts of renderPost so a future edit
 * can't silently send the button back to Back me or drop the publish hook.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const TREE_SRC = fs.readFileSync(
  path.resolve(__dirname, "..", "src", "renderer", "sidebar-tree.js"),
  "utf8",
);

test("the sidebar action button is labelled Publish, not Pitch", () => {
  assert.match(
    TREE_SRC,
    /pitchLabel\.textContent\s*=\s*["']Publish["']/,
    'the button label must be "Publish"',
  );
});

test("the button is not disabled/locked", () => {
  assert.doesNotMatch(
    TREE_SRC,
    /post\.disabled\s*=\s*true/,
    "the Publish button must not be disabled",
  );
  assert.doesNotMatch(
    TREE_SRC,
    /data-pitch-lock/,
    "the lock icon must be gone",
  );
});

test("clicking Publish opens the booklet picker", () => {
  assert.match(
    TREE_SRC,
    /post\.addEventListener\(\s*["']click["']/,
    "the Publish button must have a click handler",
  );
  assert.match(
    TREE_SRC,
    /window\.tinkerPublishStories\.open\(\)/,
    "must delegate to the publish-stories picker",
  );
});

test("the sidebar button no longer routes to the Back me page", () => {
  // The repurposed button must not reach for the Back me opener — that path
  // moved to the profile menu (back-me.js / profile.js).
  assert.doesNotMatch(
    TREE_SRC,
    /window\.tinkerBackMe\.open\(\)/,
    "the sidebar button must not open Back me anymore",
  );
});
