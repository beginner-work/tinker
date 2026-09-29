/* TYL-66 slice 3: queued/sent/failed bubbles + MCP reply left bubbles. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const js = fs.readFileSync(path.join(root, "src/renderer/messages-thread.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");

test("thread shows queued sent failed and merges API replies with manual logging", () => {
  assert.match(js, /queued_to_send|kind:\s*"queued"/);
  assert.match(js, /send_failed|kind:\s*"failed"/);
  assert.match(js, /parseLoggedReplies\(state\.lead,\s*results\[0\]\.replies\)/);
  assert.match(js, /Reply(?:\s*\()/);
  assert.match(js, /Confirm send/);
  assert.match(js, /Sending is off/);
  assert.match(html, /data-drafts-sending/);
  assert.match(html, /Gmail account connected in your assistant/);
  assert.match(js, /From "|fromAddress/);
  assert.equal(/GOOGLE_OAUTH|gmail\.googleapis|Connect Gmail|GMAIL_REPLY_SYNC_ENABLED/.test(js + html), false);
  assert.equal(/\bTyler\b/.test(js), false);
});

test("send-only owners log replied call interview on the thread as left bubbles", () => {
  assert.match(html, /data-messages-outcomes/);
  assert.match(html, /data-outcome="replied"/);
  assert.match(html, /data-outcome="call"/);
  assert.match(html, /data-outcome="interview"/);
  assert.match(js, /logOutcome|appendManualReplyNote/);
  assert.match(js, /Logged by you|Marked /);
  assert.match(css, /\.messages-thread__outcomes\b/);
});

test("bubble styles cover queued failed sent and lead left", () => {
  assert.match(css, /\.messages-thread__item--queued\b/);
  assert.match(css, /\.messages-thread__item--failed\b/);
  assert.match(css, /\.messages-thread__item--sent\b/);
  assert.match(css, /\.messages-thread__item--lead\b/);
  assert.match(css, /messages-thread__queued-tag/);
  assert.match(css, /messages-thread__failed-tag/);
  assert.match(css, /messages-thread__send-btn/);
});
