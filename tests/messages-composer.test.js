/* TYL-65: invisible notepad composer; notes only (no outreach review UI). */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "src/renderer/messages-composer.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
const draftsJs = fs.readFileSync(path.join(root, "src/renderer/lead-drafts.js"), "utf8");
const settings = fs.readFileSync(path.join(root, "src/renderer/settings/index.html"), "utf8");

test("composer is invisible notepad with Keep crafting / This is everything", () => {
  assert.match(html, /id="messages-composer"/);
  assert.match(html, /messages-composer\.js/);
  assert.match(html, /messages-notepad\.js/);
  assert.match(js, /tinkerMessagesNotepad|tinkerMessagesComposer/);
  assert.match(js, /This is everything/);
  assert.match(js, /Keep crafting/);
  assert.equal(/data-composer-ship/.test(html), false);
  assert.equal(/data-composer-channel/.test(html), false);
  assert.equal(/>Ship</.test(html), false);
  assert.equal(/\bSend\b/.test(html.match(/id="messages-composer"[\s\S]*?<\/footer>/)[0]), false);
  assert.equal(/sendgrid|MESSAGING_SEND/.test(js), false);
  assert.equal(/\bTyler\b/.test(js + html), false);
});

test("notes stay on the lead; no outreach review form in Tinker", () => {
  assert.match(js, /saveNotes/);
  assert.match(js, /notes:\s*notes/);
  assert.match(js, /PATCH\",\s*\"edit\"/);
  assert.match(js, /Notes for /);
  assert.match(js, /onPrimary:\s*function\s*\(\)\s*\{\s*saveNotes\("done"\)/);
  // Review happens outside Tinker: never build To/Subject/Body or approve UI.
  // stripReviewUi may still name legacy selectors so old nodes get removed.
  assert.equal(/Review before handoff/.test(js), false);
  assert.equal(/data-review-to/.test(js), false);
  assert.equal(/data-review-subject/.test(js), false);
  assert.equal(/data-review-body/.test(js), false);
  assert.equal(/approveReview/.test(js), false);
  assert.equal(/ensureReview/.test(js), false);
  assert.equal(/mountReview/.test(js), false);
  assert.equal(/POST\",\s*\"approve\"/.test(js), false);
  assert.equal(/needs a recipient/.test(js), false);
  assert.equal(/\.messages-review\b/.test(css), false);
  assert.equal(/onPrimary:\s*function\s*\(\)\s*\{\s*saveDraft\("ship"\)/.test(js), false);
});

test("sidebar draft list is gone; outreach settings live on /settings", () => {
  assert.equal(/data-drafts-list/.test(html), false);
  assert.equal(/data-drafts-from/.test(html), false);
  assert.match(settings, /data-drafts-from/);
  assert.match(settings, /data-drafts-booking/);
  assert.match(html, /href="\/settings"/);
  assert.match(draftsJs, /Draft list removed in TYL-65/);
});

test("composer styles stay flat", () => {
  assert.match(css, /\.messages-composer\b/);
  assert.match(css, /messages-notepad-active|writing--in-messages/);
  assert.equal(/\.messages-composer[^{]*\{[^}]*box-shadow/.test(css), false);
});

test("person notepad opening logo is a small fixed mark, not a fill avatar", () => {
  assert.match(js, /messages-notepad__mark/);
  assert.match(js, /width:\s*["']18["']/);
  assert.match(js, /height:\s*["']18["']/);
  assert.match(js, /messages-notepad__mark-img/);
  assert.equal(/fillCompanyLogo\(wrap/.test(js), false);
  assert.match(css, /\.messages-notepad__mark\b/);
  assert.match(css, /width:\s*18px\s*!important/);
  assert.match(css, /height:\s*18px\s*!important/);
  assert.match(css, /\.messages-notepad__input\b/);
});

test("settings page hosts profile fields, page links, and outreach", () => {
  assert.match(settings, /data-owner-title/);
  assert.match(settings, /data-owner-linkedin/);
  assert.match(settings, /href="\/story-parts"/);
  assert.match(settings, /href="\/leads"/);
  assert.match(settings, /href="\/career"/);
  assert.match(settings, /href="\/autonomy"/);
  assert.match(settings, /href="\/mcp\/access"/);
  assert.match(settings, /data-drafts-from/);
  assert.match(settings, /© 2026 tinker/);
  assert.match(settings, /settings\.js/);
});

test("channel and date selectors are not in the composer chrome", () => {
  assert.equal(/data-composer-date-btn/.test(html), false);
  assert.equal(/messages-composer__chips/.test(html), false);
  assert.equal(/type="date"[^>]*class="messages-composer__date-input"/.test(html), false);
  assert.equal(/messages-composer__field--block/.test(html), false);
});

test("mobile thread header clears the hamburger and spaces title from links", () => {
  assert.match(css, /body\.messages-mobile-thread \.messages-pane__top/);
  assert.match(css, /padding:[^;]*68px/);
  assert.match(css, /\.messages-pane__heading[\s\S]*flex-direction:\s*column/);
  assert.match(css, /body\.messages-mobile-thread \.messages-pane__heading[^}]*gap:\s*10px/);
});
