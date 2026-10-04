/* Public surfaces must not expose tyler.lindow@gmail.com.
 * Contact / compose authuser is tyler@lindowlabs.dev.
 * Auth-identity map keys and account fixtures are out of scope (leave alone).
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const PRIVATE = "tyler.lindow@gmail.com";
const PUBLIC = "tyler@lindowlabs.dev";

const PUBLIC_ROOTS = [
  "src/renderer",
  "README.md",
  "pitch-deck.html",
  "vercel.json",
  "api/gmail.js",
  "api/_lib/gmail-deep-link.js",
];

function walkFiles(abs, out) {
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(abs)) {
      if (name === "node_modules" || name === ".git" || name === "dist") continue;
      walkFiles(path.join(abs, name), out);
    }
    return;
  }
  if (/\.(html|js|css|md|json)$/i.test(abs)) out.push(abs);
}

function publicFiles() {
  const files = [];
  for (const rel of PUBLIC_ROOTS) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    walkFiles(abs, files);
  }
  return files;
}

test("public UI, docs, and /gmail builders never ship tyler.lindow@gmail.com", () => {
  const hits = [];
  for (const file of publicFiles()) {
    const text = fs.readFileSync(file, "utf8");
    if (text.includes(PRIVATE)) hits.push(path.relative(root, file));
  }
  assert.deepEqual(hits, [], `public surfaces must not contain ${PRIVATE}: ${hits.join(", ")}`);
});

test("Gmail deep-link authuser is the public lindowlabs address", () => {
  const gmail = require("../api/_lib/gmail-deep-link.js");
  assert.equal(gmail.GMAIL_AUTHUSER, PUBLIC);
  const web = gmail.buildWebUrl({ to: "friend@example.com", subject: "Hi", body: "Hello" });
  assert.match(web, /authuser=tyler%40lindowlabs\.dev/);
  assert.equal(web.includes(encodeURIComponent(PRIVATE)), false);
});

test("renderer HTML has no mailto: for Tyler's personal Gmail", () => {
  const htmlFiles = publicFiles().filter((f) => f.endsWith(".html"));
  for (const file of htmlFiles) {
    const text = fs.readFileSync(file, "utf8");
    assert.equal(
      /mailto:\s*tyler\.lindow@gmail\.com/i.test(text),
      false,
      path.relative(root, file)
    );
  }
});
