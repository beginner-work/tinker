/* UI-contract: sign-in / sign-up auth gate copy has no em dashes. */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RENDERER = path.join(__dirname, "..", "src", "renderer");

const LEDE =
  "Enter your phone number and we'll text you a six-digit code. New numbers create an account.";
const FINEPRINT =
  "Sign-up and login use the same screen. First-time users get an account created automatically when they verify.";

function stripCommentsAndScripts(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
}

test("sign-in page uses the owner-approved lede and fineprint", () => {
  const html = fs.readFileSync(path.join(RENDERER, "index.html"), "utf8");
  const auth = fs.readFileSync(path.join(RENDERER, "auth.js"), "utf8");
  assert.ok(html.includes(LEDE), "index.html must include the exact lede");
  assert.ok(auth.includes(LEDE), "auth.js must reset to the exact lede");
  // Fineprint may wrap across lines in HTML.
  assert.match(
    html.replace(/\s+/g, " "),
    /Sign-up and login use the same screen\.\s*First-time users get an account created automatically when they verify\./,
  );
  assert.ok(!LEDE.includes("—") && !FINEPRINT.includes("—"), "approved copy must not contain em dashes");
  assert.ok(!html.includes("Enter your phone —"), "old lede must be gone from index.html");
  assert.ok(!auth.includes("Enter your phone —"), "old lede must be gone from auth.js");
  assert.ok(!html.includes("share this screen —"), "old fineprint must be gone");
});

test("sign-in auth-gate visible copy has no em dash", () => {
  const html = fs.readFileSync(path.join(RENDERER, "index.html"), "utf8");
  const start = html.indexOf('id="auth-gate"');
  assert.ok(start >= 0, "auth-gate must exist");
  // Slice from auth-gate through the end of its inner block (made-by link closes the gate).
  const gateChunk = html.slice(start, html.indexOf("mode-nav", start));
  const visible = stripCommentsAndScripts(gateChunk);
  assert.equal(
    visible.includes("—"),
    false,
    "auth-gate user-visible markup must not contain an em dash",
  );
});
