#!/usr/bin/env node
/* Fail when U+2014 (em dash) appears in surfaces that contract tests scan.
 *
 * Full-repo bans are not viable: prompts and older comments still use em
 * dashes on purpose. This checker covers the files that have already
 * broken CI (#379, #398, #418) so agents catch them before push.
 *
 * No new dependencies. Prints file:line for each hit.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const EM = "\u2014";

/** Whole-file scan (comments count). Matches tests that read the raw source. */
const RAW_FILES = [
  "src/renderer/messages-you.js",
  "src/renderer/messages/demo-you.html",
  "src/renderer/membership.js",
  "src/renderer/autonomy/index.html",
  "src/renderer/autonomy/catalog.js",
  "src/renderer/career/index.html",
  "src/renderer/linkedin-draft.js",
  "api/mcp.js",
];

/** Scan after stripping // and block comments (product copy only). */
const STRIP_COMMENT_FILES = [
  "src/renderer/messages-shell.js",
  "src/renderer/messages-thread.js",
];

function stripJsComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function hitsInText(text) {
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(EM)) out.push(i + 1);
  }
  return out;
}

function checkRaw(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  return hitsInText(fs.readFileSync(abs, "utf8")).map((line) => `${rel}:${line}`);
}

function checkStripped(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  const raw = fs.readFileSync(abs, "utf8");
  const product = stripJsComments(raw);
  if (!product.includes(EM)) return [];
  const out = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes(EM)) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    out.push(`${rel}:${i + 1}`);
  }
  if (out.length === 0) out.push(`${rel}:? (em dash outside comments)`);
  return out;
}

function checkMigrations() {
  const dir = path.join(root, "prisma", "migrations");
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const sql = path.join(dir, name, "migration.sql");
    if (!fs.existsSync(sql)) continue;
    const rel = path.relative(root, sql);
    for (const line of hitsInText(fs.readFileSync(sql, "utf8"))) {
      out.push(`${rel}:${line}`);
    }
  }
  return out;
}

const findings = [];
for (const rel of RAW_FILES) findings.push(...checkRaw(rel));
for (const rel of STRIP_COMMENT_FILES) findings.push(...checkStripped(rel));
findings.push(...checkMigrations());

if (findings.length) {
  console.error("Em dash (U+2014) found in contract-scanned source:");
  for (const hit of findings) console.error(`  ${hit}`);
  console.error("Replace with a hyphen, colon, or period. See docs/loop-log.md.");
  process.exit(1);
}

console.log("check-em-dash: ok");
