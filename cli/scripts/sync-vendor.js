#!/usr/bin/env node
/**
 * Copy interview prompt + model ids into cli/vendor so a global
 * `npm i -g ./cli` install has no monorepo dependency at runtime.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const vendor = path.join(__dirname, "../vendor");

const copies = [
  {
    from: path.join(root, "src/renderer/interview-prompt.js"),
    to: path.join(vendor, "interview-prompt.js"),
  },
  {
    from: path.join(root, "src/renderer/lib/claude-models.js"),
    to: path.join(vendor, "lib/claude-models.js"),
  },
];

fs.mkdirSync(path.join(vendor, "lib"), { recursive: true });
for (const { from, to } of copies) {
  fs.copyFileSync(from, to);
  process.stdout.write(`synced ${path.relative(root, to)}\n`);
}
