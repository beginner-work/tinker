/* UI-contract regression guard for the welcome (feed) screen.
 *
 * This is a structural smoke test, not a behavioural one — it parses the
 * shipped renderer source and asserts that the welcome screen's load-
 * bearing pieces are present and wired. It exists because a previous
 * change (the "No AI mode" reframe, PR #208) silently removed the entire
 * location seed flow from the welcome page and replaced it with a single
 * "Write without AI" banner, breaking the primary way founders start a
 * session. A diff that deletes any of these anchors now fails CI instead
 * of shipping a broken welcome screen.
 *
 * The contract is deliberately about *structure that must exist*, not
 * exact copy or styling — those are free to evolve. Two things must hold
 * together:
 *
 *   1. The location seed flow — the grid of places (Cafe / Home / Work /
 *      Somewhere else) plus the "Somewhere else" specify form — is the
 *      original, AI-guided way in. Picking a place starts a session.
 *   2. The floating glass mode nav (#mode-nav: AI / No AI) is a pure mode
 *      switch. On the welcome screen it only decides which screen the
 *      next session opens into; it must never replace the seed flow.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RENDERER = path.join(__dirname, "..", "src", "renderer");
const html = fs.readFileSync(path.join(RENDERER, "index.html"), "utf8");
const rendererJs = fs.readFileSync(path.join(RENDERER, "renderer.js"), "utf8");

test("welcome screen keeps the location seed flow markup", () => {
  // The grid container and its four locations are the entry point.
  assert.match(html, /id="welcome-grid"/, "welcome-grid container is missing");
  for (const loc of ["cafe", "home", "work", "other"]) {
    assert.match(
      html,
      new RegExp(`data-location="${loc}"`),
      `welcome grid is missing the "${loc}" location tile`
    );
  }
  // "Somewhere else" reveals a free-text specify form.
  assert.match(html, /id="welcome-form"/, "welcome-form is missing");
  assert.match(html, /id="welcome-input"/, "welcome-input is missing");
});

test("welcome screen keeps the glass AI / No AI mode nav", () => {
  assert.match(html, /id="mode-nav"/, "#mode-nav glass component is missing");
  assert.match(html, /id="mode-ai"/, "mode-nav AI segment is missing");
  assert.match(html, /id="mode-noai"/, "mode-nav No AI segment is missing");
});

test("renderer wires the location grid to start a session", () => {
  assert.match(
    rendererJs,
    /getElementById\("welcome-grid"\)/,
    "renderer.js no longer reads #welcome-grid"
  );
  // Picking a place must lead into a session.
  assert.match(
    rendererJs,
    /tinkerNewSession/,
    "renderer.js no longer starts a session from the welcome grid"
  );
});

test("the welcome page does not regress to the removed No-AI banner", () => {
  // The mode nav covers No AI; the welcome page must not reintroduce the
  // hero banner that displaced the seed flow.
  assert.doesNotMatch(
    html,
    /welcome__noai|id="welcome-noai"/,
    'the removed "Write without AI" welcome banner is back'
  );
});
