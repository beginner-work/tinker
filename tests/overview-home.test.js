/* Lindow Labs overview home: inbox chrome removed; writing one click away. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const overviewJs = fs.readFileSync(path.join(root, "src/renderer/overview/overview.js"), "utf8");
const overviewCss = fs.readFileSync(path.join(root, "src/renderer/overview/overview.css"), "utf8");
const shell = fs.readFileSync(path.join(root, "src/renderer/messages-shell.js"), "utf8");
const catalog = fs.readFileSync(path.join(root, "src/renderer/exercises/catalog.js"), "utf8");
const settings = fs.readFileSync(path.join(root, "src/renderer/settings/index.html"), "utf8");
const settingsJs = fs.readFileSync(path.join(root, "src/renderer/settings/settings.js"), "utf8");
const mainJs = fs.readFileSync(path.join(root, "src/main/main.js"), "utf8");
const preload = fs.readFileSync(path.join(root, "src/main/preload.js"), "utf8");

test("home boots as Lindow Labs overview, not inbox", () => {
  assert.match(html, /<body[^>]*class="[^"]*overview-primary/);
  assert.equal(/<body[^>]*messages-inbox-primary/.test(html), false);
  assert.match(html, /id="overview"/);
  assert.match(html, /Lindow Labs/);
  assert.match(html, /Current exercises/);
  assert.match(html, />Readings</);
  assert.match(html, />Roles</);
  assert.match(html, /data-overview-formation/);
  assert.match(html, /overview\/overview\.js/);
  assert.match(html, /exercises\/catalog\.js/);
});

test("Write entry is one click from overview; writing modules stay critical", () => {
  assert.match(html, /data-overview-write/);
  assert.match(html, />Write</);
  assert.match(overviewJs, /openWrite/);
  assert.match(shell, /openWriteFromOverview|openWrite/);
  assert.match(shell, /showOverviewHome/);
  assert.match(shell, /isOverviewMode/);
  assert.match(shell, /refreshOwnerProfileOnly/);
  // Critical path includes You writing surface.
  const withoutLazy = html.replace(/<template id="tinker-lazy-scripts">[\s\S]*?<\/template>/, "");
  assert.match(withoutLazy, /messages-shell\.js/);
  assert.match(withoutLazy, /messages-you\.js/);
  assert.match(withoutLazy, /writing\.js/);
  assert.match(overviewCss, /overview-writing/);
});

test("overview mode does not poll the inbox triage queue", () => {
  assert.match(shell, /Writing surface only — no inbox list or triage polling/);
  assert.match(shell, /if \(isOverviewMode\(\)\)/);
  // Inbox APIs remain in the module for non-overview / MCP-era callers.
  assert.match(shell, /leadsApi\(["']inbox["']\)/);
  assert.match(shell, /list_inbox|rankInboxItems|leadsApi/);
});

test("exercises use cursorProjectRoot and cursor://file deep links", () => {
  assert.match(catalog, /tinker\.cursorProjectRoot/);
  assert.match(catalog, /exercises\/pacific-wall-time\.js/);
  assert.match(overviewJs, /cursor:\/\/file\//);
  assert.match(overviewJs, /cursorProjectRoot/);
  assert.match(settings, /cursorProjectRoot/);
  assert.match(settingsJs, /tinker\.cursorProjectRoot/);
  assert.match(preload, /pickCursorRoot/);
  assert.match(mainJs, /cursorRoot:pick/);
});

test("desktop docks ElevenReader and Formation; postings open externally", () => {
  assert.match(mainJs, /WebContentsView/);
  assert.match(mainJs, /persist:tinker-docked/);
  assert.match(mainJs, /elevenreader\.io/);
  assert.match(mainJs, /formation\.dev/);
  assert.match(preload, /openDockedPanel/);
  assert.match(overviewJs, /forceBrowser:\s*true/);
  assert.match(overviewJs, /openDockedPanel/);
});

test("settings back link is Home, not Inbox", () => {
  assert.match(settings, /← Home/);
  assert.equal(/← Inbox/.test(settings), false);
});
