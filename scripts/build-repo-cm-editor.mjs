#!/usr/bin/env node
/* Bundle CodeMirror 6 + languages into a single CSP-safe IIFE for /repo. */
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "src/renderer/lib/repo-cm-editor-src.mjs");
const outfile = path.join(root, "src/renderer/vendor/codemirror-repo-editor.min.js");

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "tinkerCodeMirror",
  platform: "browser",
  target: ["es2020"],
  outfile,
  logLevel: "info",
});

console.log("wrote", outfile);
