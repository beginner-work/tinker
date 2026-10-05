/* UI-contract: Made by Lindow Labs credit on sign-up and settings. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MADE_BY_URL =
  "https://lindowlabs.dev/?utm_source=tinker&utm_campaign=made-by";
const MADE_BY_LABEL = "Made by Lindow Labs";

const RENDERER = path.join(__dirname, "..", "src", "renderer");

function decodeAmp(html) {
  return html.replace(/&amp;/g, "&");
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

test("write page wires Made by opener for the top-right Labs link", () => {
  const html = fs.readFileSync(path.join(RENDERER, "repo", "index.html"), "utf8");
  assert.match(html, /id="repo-labs-link"/);
  assert.ok(html.includes("Lindow Labs"));
  assert.ok(
    decodeAmp(html).includes(MADE_BY_URL),
    "write page Labs link must use the exact Lindow Labs URL with utm params",
  );
  assert.match(html, /data-made-by-lindow-labs/);
  assert.match(html, /made-by-lindow-labs\.js/);
  // Must not sit under/after the writing surface.
  const beforeSurface = html.slice(0, html.indexOf('id="repo-surface"'));
  assert.match(beforeSurface, /id="repo-labs-link"/);
});
