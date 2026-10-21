#!/usr/bin/env node
"use strict";

const { main } = require("../lib/main.js");

main(process.argv.slice(2)).catch((err) => {
  const msg = (err && err.message) || String(err);
  process.stderr.write(msg + "\n");
  process.exit(typeof err?.exitCode === "number" ? err.exitCode : 1);
});
