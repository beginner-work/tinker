#!/usr/bin/env node
/* Local mirror of the checks CI / Vercel run before an agent pushes.
 *
 * Order matches the install + verify path agents hit in production:
 *   1. prisma generate  (npm postinstall + vercel.json buildCommand)
 *   2. em dash contract surfaces
 *   3. unit-glob / Playwright guard
 *   4. npm test         (.github/workflows/ci.yml)
 */
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");

function run(label, command, args) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`\ncheck failed at: ${label}`);
    process.exit(result.status == null ? 1 : result.status);
  }
}

run("prisma generate", "npx", ["prisma", "generate"]);
run("em dash check", "node", ["scripts/check-em-dash.js"]);
run("unit glob check", "node", ["scripts/check-unit-glob.js"]);
run("npm test", "npm", ["test"]);

console.log("\ncheck: all passed");
