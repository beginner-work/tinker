"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const config = fs.readFileSync(
  path.join(__dirname, "..", "electron-builder.yml"),
  "utf8",
);

test("Windows portable artifact has a unique release filename", () => {
  assert.match(
    config,
    /^portable:\n  artifactName: \$\{productName\}-\$\{version\}-\$\{arch\}-portable\.\$\{ext\}$/m,
  );
});
