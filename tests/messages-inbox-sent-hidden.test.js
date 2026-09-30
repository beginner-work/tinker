/* Inbox rail hides people whose outreach is already sent (UI only). */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");

const root = path.join(__dirname, "..");
const shell = fs.readFileSync(path.join(root, "src/renderer/messages-shell.js"), "utf8");
const thread = fs.readFileSync(path.join(root, "src/renderer/messages-thread.js"), "utf8");

test("visibleLeads drops sent_by_owner / sent people from the rail", () => {
  assert.match(shell, /function leadHasSentOutreach/);
  assert.match(shell, /function visibleLeads/);
  assert.match(shell, /leadHasSentOutreach\(lead\.id\)/);
  assert.match(shell, /sent_by_owner/);
  assert.match(shell, /d\.status === "sent"/);
  // Direct selectLead / URL path is unchanged — filter is render-only.
  assert.match(shell, /function selectLead/);
});

test("thread collectItems skips sent bubbles entirely", () => {
  assert.match(thread, /sent_by_owner/);
  assert.match(thread, /d\.status === "sent"/);
  assert.equal(/Sent via/.test(thread), false);
  assert.match(thread, /Handed off\. Your assistant will send this/);
});
