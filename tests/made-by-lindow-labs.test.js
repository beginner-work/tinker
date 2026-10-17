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
    learningLab: />\s*Learning Lab\s*</.test(stripped),
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

test("write page keeps tinker mark + past-essays hamburger", () => {
  const html = fs.readFileSync(path.join(RENDERER, "repo", "index.html"), "utf8");
  const src = fs.readFileSync(path.join(RENDERER, "made-by-lindow-labs.js"), "utf8");
  const css = fs.readFileSync(path.join(RENDERER, "repo", "repo.css"), "utf8");
  assert.match(html, /id="repo-labs-link"/);
  assert.match(html, /data-technical-essays-nav/);
  assert.match(html, /aria-label="Technical essays"/);
  assert.match(html, /tinker-mark\.svg/);
  assert.doesNotMatch(html, /M14\.4 14\.4 9\.6 9\.6/);
  assert.match(html, /made-by-lindow-labs\.js/);
  assert.match(html, /id="repo-past-essays"/);
  assert.match(html, /aria-label="Business essays"/);
  assert.match(html, /repo-layout--learning/);
  assert.match(src, /data-technical-essays-nav/);
  assert.match(src, /toggleTechnicalEssaysNav|toggleExercisesNav/);
  assert.ok(src.includes(LEARNING_LAB_URL));
  assert.match(src, /LEARNING_LAB_URL/);
  assert.match(src, /data-learning-lab/);
  assert.match(src, /openDrawer/);
  assert.match(src, /labs-drawer/);
  assert.match(src, /framingLooksBlocked/);
  assert.match(css, /\.labs-drawer/);
  assert.match(css, /\.labs-drawer__panel/);
  assert.match(css, /\.repo-top__labs/);
  assert.match(html, /tinker-mark\.svg/);
  assert.match(html, /frame-src https:\/\/lindowlabs\.dev/);
  const phrases = visibleLearningPhrases(html);
  assert.equal(phrases.learningLab, false, "no visible Learning Lab text on trigger");
  assert.equal(phrases.learningLabs, false, "no visible Learning Labs text");
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
