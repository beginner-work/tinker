/* TYL-63 top-of-funnel sidebar UI against GET action=funnel. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("funnel sidebar markup logos pay badges referral and deep links", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "src/renderer/lead-funnel.js"), "utf8");
  const drafts = fs.readFileSync(path.join(root, "src/renderer/lead-drafts.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
  const mobile = fs.readFileSync(path.join(root, "src/renderer/mobile-drawer.css"), "utf8");
  const sw = fs.readFileSync(path.join(root, "src/renderer/sw.js"), "utf8");
  const leadsUi = fs.readFileSync(path.join(root, "src/renderer/leads/leads.js"), "utf8");
  assert.match(html, /id="sidebar-funnel"/);
  assert.match(html, /lead-funnel\.js/);
  assert.match(js, /action=funnel/);
  assert.match(js, /icons\.duckduckgo\.com\/ip3\//);
  assert.match(js, /nextReferrer/);
  assert.match(js, /Referral/);
  assert.match(js, /Clears floor/);
  assert.match(js, /Below floor/);
  assert.match(js, /No pay data/);
  assert.match(js, /setCompanyFilter/);
  assert.match(js, /\/leads\?lead=/);
  assert.match(drafts, /setCompanyFilter/);
  assert.match(css, /\.sidebar__funnel\b/);
  assert.match(css, /\.sidebar__funnel-pay--clears\b/);
  assert.match(mobile, /\.sidebar__funnel/);
  assert.match(sw, /lead-funnel\.js/);
  assert.match(leadsUi, /pickLeadFromQuery/);
  assert.equal(/\bTyler\b/.test(js + html), false);
});
