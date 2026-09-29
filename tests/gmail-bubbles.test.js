/* LL-66 slice 3: queued/failed/sent bubbles + MCP reply left bubbles. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const js = fs.readFileSync(path.join(root, "src/renderer/messages-thread.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");

test("thread maps queued, failed, sent, and MCP replies", () => {
  assert.match(js, /kind:\s*"queued"|kind === "queued"/);
  assert.match(js, /kind:\s*"failed"|kind === "failed"/);
  assert.match(js, /approved_to_send/);
  assert.match(js, /send_failed/);
  assert.match(js, /parseLoggedReplies\(state\.lead,\s*results\[0\]\.replies\)/);
  assert.match(js, /pushReply/);
  assert.match(js, /Queued\. Your assistant will send this through Gmail/);
  assert.match(js, /Send failed/);
  assert.match(js, /messages-thread__queued-tag/);
  assert.match(js, /messages-thread__failed-tag/);
});

test("queued and failed bubble styles are present", () => {
  assert.match(css, /\.messages-thread__item--queued\b/);
  assert.match(css, /\.messages-thread__item--failed\b/);
  assert.match(css, /\.messages-thread__queued-tag\b/);
  assert.match(css, /\.messages-thread__failed-tag\b/);
});
