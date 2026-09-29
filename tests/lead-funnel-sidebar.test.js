/* TYL-63 hunt funnel sidebar — uses leads funnel API; no duplicate data layer. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("funnel sidebar uses GET funnel, DuckDuckGo logos, referral first, pay labels", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "src/renderer/lead-funnel.js"), "utf8");
  const drafts = fs.readFileSync(path.join(root, "src/renderer/lead-drafts.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
  const mobile = fs.readFileSync(path.join(root, "src/renderer/mobile-drawer.css"), "utf8");
  const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
  const api = fs.readFileSync(path.join(root, "api/leads.js"), "utf8");

  assert.match(html, /id="sidebar-funnel"/);
  assert.ok(html.indexOf("sidebar-funnel") < html.indexOf("sidebar-drafts"), "funnel above drafts");
  assert.match(html, /lead-funnel\.js/);
  assert.match(js, /action=funnel|action=" \+ encodeURIComponent\(action\)/);
  assert.match(js, /icons\.duckduckgo\.com\/ip3/);
  assert.match(js, /duckduckgo\.com\/privacy/);
  assert.match(js, /nextReferrer/);
  assert.match(js, /Referral/);
  assert.match(js, /Clears floor|Below floor|No pay data/);
  assert.match(js, /setCompanyFilter/);
  assert.match(js, /\/leads\?lead=/);
  assert.match(drafts, /setCompanyFilter/);
  assert.equal(/\bTyler\b/.test(js + html), false);
  assert.match(css, /\.sidebar__funnel\b/);
  assert.match(mobile, /\.sidebar__funnel/);
  assert.match(sw, /lead-funnel\.js/);
  assert.match(api, /action === "funnel"/);
  assert.equal(fs.existsSync(path.join(root, "api/_lib/leads-companies-store.js")), true);
});
