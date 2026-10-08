/* UI-contract: Made by Lindow Labs credit + beaker labs drawer. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const MADE_BY_URL =
  "https://lindowlabs.dev/?utm_source=tinker&utm_campaign=made-by";
const MADE_BY_LABEL = "Made by Lindow Labs";
const LEARNING_LAB_URL = "https://lindowlabs.dev/learning";

const RENDERER = path.join(__dirname, "..", "src", "renderer");

function decodeAmp(html) {
  return html.replace(/&amp;/g, "&");
}

/** Visible copy must not include these phrases (aria-label is fine). */
function visibleLearningPhrases(html) {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/aria-label="[^"]*"/gi, "")
    .replace(/aria-label='[^']*'/gi, "");
  return {
    learningLab: />\s*Learning Lab\s*</.test(stripped) || /repo-top__labs-label/.test(stripped),
    learningLabs: /Learning Labs/.test(stripped),
    lindowLabsLearning: /Lindow Labs Learning/.test(stripped),
  };
}

test("sign-up auth gate has Made by Lindow Labs with the exact URL", () => {
  const html = fs.readFileSync(path.join(RENDERER, "index.html"), "utf8");
  assert.match(html, /id="auth-gate"/);
  assert.ok(html.includes(MADE_BY_LABEL), "auth gate must include Made by Lindow Labs");
  assert.ok(
    decodeAmp(html).includes(MADE_BY_URL),
    "auth gate must include the exact Lindow Labs URL with utm params",
  );
  assert.match(
    html,
    /data-made-by-lindow-labs[\s\S]*?target="_blank"[\s\S]*?rel="noopener"|target="_blank"[\s\S]*?rel="noopener"[\s\S]*?data-made-by-lindow-labs/,
  );
  assert.ok(
    !MADE_BY_LABEL.includes("—") && !MADE_BY_LABEL.includes("–"),
    "credit copy must not use an em/en dash",
  );
  assert.match(html, /made-by-lindow-labs\.js/);
});

test("settings page has Made by Lindow Labs with the exact URL", () => {
  const html = fs.readFileSync(path.join(RENDERER, "settings", "index.html"), "utf8");
  assert.ok(html.includes(MADE_BY_LABEL), "settings must include Made by Lindow Labs");
  assert.ok(
    decodeAmp(html).includes(MADE_BY_URL),
    "settings must include the exact Lindow Labs URL with utm params",
  );
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener"/);
  assert.match(html, /data-made-by-lindow-labs/);
  assert.match(html, /made-by-lindow-labs\.js/);
});

test("made-by opener uses the desktop openExternal bridge", () => {
  const src = fs.readFileSync(path.join(RENDERER, "made-by-lindow-labs.js"), "utf8");
  assert.match(src, /tinker\.openExternal/);
  assert.ok(src.includes(MADE_BY_URL));
  const sw = fs.readFileSync(path.join(RENDERER, "sw.js"), "utf8");
  assert.match(sw, /made-by-lindow-labs\.js/);
});

test("write page wires beaker labs drawer opener (not under writing)", () => {
  const html = fs.readFileSync(path.join(RENDERER, "repo", "index.html"), "utf8");
  const src = fs.readFileSync(path.join(RENDERER, "made-by-lindow-labs.js"), "utf8");
  const css = fs.readFileSync(path.join(RENDERER, "repo", "repo.css"), "utf8");
  assert.match(html, /id="repo-labs-link"/);
  assert.ok(
    decodeAmp(html).includes(LEARNING_LAB_URL),
    "write page labs link must use the learning dashboard URL",
  );
  assert.match(html, /data-learning-lab/);
  assert.match(html, /aria-label="Open lab"/);
  assert.match(html, /made-by-lindow-labs\.js/);
  assert.match(html, /id="repo-past-essays"/);
  assert.match(html, /aria-label="Past essays"/);
  assert.ok(src.includes(LEARNING_LAB_URL));
  assert.match(src, /LEARNING_LAB_URL/);
  assert.match(src, /data-learning-lab/);
  assert.match(src, /openDrawer/);
  assert.match(src, /labs-drawer/);
  assert.match(src, /framingLooksBlocked/);
  assert.match(css, /\.labs-drawer/);
  assert.match(css, /\.labs-drawer__panel/);
  assert.match(html, /frame-src https:\/\/lindowlabs\.dev/);
  // Beaker paths (FlaskConical), not the old link-out icon.
  assert.match(html, /M10 2v7\.527/);
  assert.doesNotMatch(html, /M6\.5 3\.5H3\.75/);
  // No visible Learning Lab copy on the trigger / drawer chrome.
  const phrases = visibleLearningPhrases(html);
  assert.equal(phrases.learningLab, false, "no visible Learning Lab text");
  assert.equal(phrases.learningLabs, false, "no visible Learning Labs text");
  assert.equal(phrases.lindowLabsLearning, false, "no visible Lindow Labs Learning text");
  assert.doesNotMatch(html, /repo-top__labs-label/);
  // Must not sit under/after the writing surface.
  const beforeSurface = html.slice(0, html.indexOf('id="repo-surface"'));
  assert.match(beforeSurface, /id="repo-labs-link"/);
});

test("framingLooksBlocked: about:blank is blocked, cross-origin is ok", () => {
  const src = fs.readFileSync(path.join(RENDERER, "made-by-lindow-labs.js"), "utf8");
  const sandbox = {
    window: { tinkerMadeByLindowLabs: null },
    document: {
      readyState: "complete",
      addEventListener() {},
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(src, sandbox);
  const api = sandbox.window.tinkerMadeByLindowLabs;
  assert.equal(typeof api.framingLooksBlocked, "function");

  assert.equal(api.framingLooksBlocked(null), true);
  assert.equal(api.framingLooksBlocked({ contentWindow: null }), true);

  assert.equal(
    api.framingLooksBlocked({
      contentWindow: { location: { href: "about:blank" } },
    }),
    true,
  );

  assert.equal(
    api.framingLooksBlocked({
      contentWindow: {
        get location() {
          throw new Error("SecurityError");
        },
      },
    }),
    false,
  );

  assert.equal(
    api.framingLooksBlocked({
      contentWindow: { location: { href: "https://lindowlabs.dev/learning" } },
    }),
    false,
  );
});
