"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const config = fs.readFileSync(path.join(__dirname, "..", "electron-builder.yml"), "utf8");

test("Windows installer and portable executable have distinct release asset names", () => {
  assert.match(config, /nsis:\s*\n\s+artifactName: \$\{productName\}-\$\{version\}-setup-\$\{arch\}\.\$\{ext\}/);
  assert.match(config, /portable:\s*\n\s+artifactName: \$\{productName\}-\$\{version\}-portable-\$\{arch\}\.\$\{ext\}/);
});
