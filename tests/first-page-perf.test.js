/* First-page boot: critical path stays small; secondary modules load lazy. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { EXPECTED_SW_CACHE_VERSION } = require("./helpers/sw-cache-version.js");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
const shell = fs.readFileSync(path.join(root, "src/renderer/messages-shell.js"), "utf8");
const you = fs.readFileSync(path.join(root, "src/renderer/messages-you.js"), "utf8");
const sync = fs.readFileSync(path.join(root, "src/renderer/sync.js"), "utf8");
const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");

function criticalDeferScripts() {
  // Scripts with defer outside the lazy template.
  const withoutTemplate = html.replace(
    /<template id="tinker-lazy-scripts">[\s\S]*?<\/template>/,
    ""
  );
  return [...withoutTemplate.matchAll(/<script src="\.\/([^"]+)" defer><\/script>/g)].map(
    (m) => m[1]
  );
}

test("writing shell remains the first-paint body class", () => {
  assert.match(html, /<body[^>]*class="[^"]*messages-shell-open/);
  // Inbox is no longer the landing chrome; write surface /repo redirect owns home.
  assert.doesNotMatch(html, /<body[^>]*messages-inbox-primary/);
});

test("secondary modules ship in the lazy template, not the critical defer list", () => {
  assert.match(html, /id="tinker-lazy-scripts"/);
  assert.match(html, /boot-lazy\.js/);
  assert.match(html, /boot-css\.js/);
  const critical = criticalDeferScripts();
  assert.ok(critical.some((src) => src.includes("messages-shell.js")));
  assert.ok(critical.some((src) => src.includes("messages-you.js")));
  assert.ok(critical.includes("writing.js"));
  assert.ok(critical.includes("boot-lazy.js"));
  for (const lazy of [
    "messages-notepad.js",
    "notes-folder.js",
    "messages-reading.js",
    "messages-application.js",
    "heatmap.js",
    "wallet.js",
    "email.js",
    "linkedin-draft.js",
    "lead-drafts.js",
    "lead-funnel.js",
    "notifications.js",
    "membership.js",
    "share.js",
    "update-banner.js",
    "pwa-install-hint.js",
    "voice-model.js",
    "transactions.js",
    "seeds.js",
    "back-me.js",
    "open-beginner.js",
  ]) {
    assert.equal(
      critical.includes(lazy),
      false,
      lazy + " must not block DOMContentLoaded"
    );
    assert.match(html, new RegExp(`src="\\./${lazy.replace(".", "\\.")}"`));
  }
});

test("fonts are brand-only and non-blocking", () => {
  assert.match(html, /data-tinker-async/);
  assert.match(html, /family=Fraunces/);
  assert.match(html, /family=Instrument\+Sans/);
  assert.equal(/family=Inter:/.test(html), false);
  assert.equal(/Plus\+Jakarta\+Sans/.test(html), false);
  assert.equal(/SOFT@/.test(html), false);
});

test("critical inbox CSS is inlined; full stylesheets load async", () => {
  assert.match(html, /<style>[\s\S]*body\.messages-shell-open \.messages-pane/);
  assert.match(html, /rel="preload" as="style" href="\.\/styles\.css" data-tinker-async/);
  assert.match(html, /design-tokens\.css" data-tinker-async/);
  assert.match(html, /mobile-drawer\.css" data-tinker-async/);
});

test("inbox refresh does not waterfall reading and applications", () => {
  assert.match(
    shell,
    /Promise\.all\(\[\s*leadsApi\("inbox"\),\s*fetchReadingThreads\(\),\s*fetchApplications\(\),/
  );
});

test("You self-thread list does not wait serially on purge_plan", () => {
  assert.match(you, /Promise\.all\(\[purge, list\]\)/);
  assert.equal(
    /purge_plan[\s\S]{0,200}\.then\(function \(\) \{\s*return fetch\("\/api\/self-thread\?action=list"/.test(
      you
    ),
    false
  );
});

test("sync hydrate is idle-deferred off the critical path", () => {
  assert.match(sync, /requestIdleCallback/);
  assert.match(sync, /kickIdle/);
});

test("static asset cache headers and SW precache stay in sync", () => {
  assert.match(vercel, /max-age=86400/);
  assert.match(sw, new RegExp(EXPECTED_SW_CACHE_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(sw, /boot-lazy\.js/);
  assert.match(sw, /boot-css\.js/);
  assert.match(sw, /notes-folder\.js/);
});
