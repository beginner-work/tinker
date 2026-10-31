#!/usr/bin/env node
"use strict";

const { main } = require("../lib/main.js");
const { getTheme } = require("../lib/theme.js");

main(process.argv.slice(2)).catch((err) => {
  const theme = getTheme({ stream: process.stderr });
  const msg = (err && err.message) || String(err);
  process.stderr.write(theme.error(msg) + "\n");
  process.exit(typeof err?.exitCode === "number" ? err.exitCode : 1);
});
