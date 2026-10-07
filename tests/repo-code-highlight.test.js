/* Unit tests for /repo exercise syntax highlighting helper. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const helperSrc = fs.readFileSync(
  path.join(root, "src/renderer/lib/repo-code-highlight.js"),
  "utf8",
);
const prismSrc = fs.readFileSync(
  path.join(root, "src/renderer/vendor/prism-languages.min.js"),
  "utf8",
);

function load() {
  const sandbox = { window: {}, globalThis: {} };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(prismSrc + "\n" + helperSrc, sandbox, { filename: "repo-code-highlight.js" });
  return sandbox.tinkerRepoCodeHighlight;
}

test("language detection maps common exercise extensions", () => {
  const api = load();
  assert.equal(api.languageFor("openapi.yaml"), "yaml");
  assert.equal(api.languageFor("package.json"), "json");
  assert.equal(api.languageFor("server.ts"), "typescript");
  assert.equal(api.languageFor("readPaymentIntentClient.js"), "javascript");
  assert.equal(api.languageFor("README.md"), null);
  assert.equal(api.isProseFile("README.md"), true);
  assert.equal(api.isProseFile("openapi.yaml"), false);
});

test("yaml highlight colors keys and comments without throwing", () => {
  const api = load();
  const html = api.highlight(
    '# Write your OpenAPI document here.\nopenapi: "3.0.3"\n',
    "yaml",
  );
  assert.match(html, /token comment|token\.comment|class="token comment"/);
  assert.match(html, /openapi/);
  assert.match(html, /3\.0\.3/);
  assert.doesNotMatch(html, /<script/);
});

test("unknown language falls back to escaped plain text", () => {
  const api = load();
  const html = api.highlight("<b>x</b>", null);
  assert.equal(html, "&lt;b&gt;x&lt;/b&gt;");
});
