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

test("notes stay on the lead; Keep crafting asks a new person question", () => {
  assert.match(js, /saveNotes/);
  assert.match(js, /notes:\s*state\.notes|notes:\s*notes/);
  assert.match(js, /PATCH\",\s*\"edit\"/);
  // UI: "Notes for …" + company paragraph must not mount in the opening
  // (thread starts at the first question). Helpers may remain for prompts.
  assert.match(js, /function buildOpening/);
  assert.equal(/opening\.appendChild\(context\)/.test(js), false);
  assert.equal(/opening\.appendChild\(prose\)/.test(js), false);
  assert.equal(/opening\.appendChild\(mark\)/.test(js), false);
  assert.match(js, /onPrimary:\s*function\s*\(\)\s*\{\s*saveNotes\("done"\)/);
  assert.match(js, /onSecondary:\s*function\s*\(\)\s*\{\s*keepCrafting\(\)/);
  assert.match(js, /function keepCrafting/);
  assert.match(js, /callClaude/);
  assert.match(js, /normalizeKeepCraftingQuestion|fallbackKeepCraftingQuestion/);
  assert.match(js, /scrollQuestionIntoView|scrollIntoView/);
  assert.match(js, /isRepeatQuestion/);
  // Seeded interview prep: one pending question; remaining ### stay in queue.
  assert.match(js, /state\.queue/);
  assert.match(js, /Seeded prep queue advances/);
  assert.match(js, /unanswered\.slice\(1\)/);
  // No editable review To/Body/approve UI — Subject card is read-only after done.
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
  assert.match(js, /data-notepad-subject|buildSubjectCard/);
  assert.match(js, /proposed-subject/);
});

test("company and person notes still reach Keep crafting + subject prompts after UI hide", () => {
  // Wiring in messages-composer: researchProse(company notes) → both prompts.
  assert.match(js, /function researchProse/);
  assert.match(js, /company\.notes/);
  assert.match(js, /researchProse\(state\.company\)/);
  assert.match(js, /companyContext:\s*research/);
  assert.match(js, /prepContext:\s*prepContext/);
  assert.match(js, /state\.preamble/);
  // Prep preamble is prompt-only — not mounted in the thread opening.
  assert.equal(/opening\.appendChild\(preamble\)/.test(js), false);
  assert.equal(/messages-notepad__section/.test(js.match(/function buildOpening[\s\S]*?return opening/)[0]), false);
  // Person notes = interview transcript turns on the lead (still in the prompt).
  assert.match(js, /api\.buildPersonUserMessage|Interview so far:/);
  assert.match(js, /What the founder shared:|buildSubjectUserMessage/);

  // Runtime: subject prompt includes the company-notes string unchanged.
  const interview = require("../src/renderer/interview-prompt.js");
  const companyNotes =
    "Alloy's Developer Experience team owns the Events API, the webhooks and the partner feeds.";
  const personAnswer = "Not sure";
  const subjectPrompt = interview.buildSubjectUserMessage({
    personName: "Faria Chaudhry",
    personTitle: "Senior Technical Recruiter II",
    companyName: "Alloy",
    companyContext: companyNotes,
    transcript: [
      {
        q: "What are you curious about in Faria Chaudhry's work at Alloy?",
        a: personAnswer,
      },
    ],
  });
  assert.match(subjectPrompt, /Company context:/);
  assert.match(subjectPrompt, /Alloy's Developer Experience team owns the Events API/);
  assert.match(subjectPrompt, /Not sure/);
  assert.match(subjectPrompt, /Faria Chaudhry/);
});

test("person Keep crafting uses PERSON_SYSTEM_PROMPT via callClaude (platform-mobile on iPhone)", () => {
  // Desktop Electron may pre-wire tinker.callClaude; on iPhone/PWA,
  // platform-mobile.js is the only provider and proxies to /api/claude/converse.
  assert.match(js, /window\.tinker\.callClaude\s*\(/);
  assert.match(js, /function keepCrafting/);
  assert.match(js, /resolveNextQuestion|buildPersonUserMessage/);
  assert.match(js, /PERSON_SYSTEM_PROMPT/);
  assert.match(js, /fallbackPersonKeepCraftingQuestion|defaultPersonQuestion/);
  assert.match(js, /What are you curious about in/);
  assert.equal(/What do you want .+ to understand about you/.test(js), false);
  assert.equal(/api\.SYSTEM_PROMPT/.test(js), false, "person path must not use founder SYSTEM_PROMPT");
  const platform = fs.readFileSync(path.join(root, "src/renderer/platform-mobile.js"), "utf8");
  assert.match(platform, /async function callClaude/);
  assert.match(platform, /\/api\/claude\/converse/);
  assert.match(platform, /tinker_jwt/);
  // index.html loads platform-mobile before the messages composer stack.
  const htmlOrder = html;
  const platIdx = htmlOrder.indexOf("platform-mobile.js");
  const composerIdx = htmlOrder.indexOf("messages-composer.js");
  assert.ok(platIdx >= 0 && composerIdx >= 0, "both scripts present");
  // platform-mobile is deferred near the end; composer is earlier but both
  // share window.tinker — assert platform-mobile is the web/iPhone shim.
  assert.match(htmlOrder, /platform-mobile\.js/);
  assert.equal(/askNext\s*\(/.test(js), false, "person path must not use You askNext");
  assert.equal(/ask_followups/.test(js), false, "person path must not call MCP ask_followups");
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

test("mobile thread header is push-nav: back only, no hamburger drawer", () => {
  assert.match(html, /data-messages-lead/);
  assert.match(html, /data-messages-back/);
  assert.equal(/data-messages-menu/.test(html), false);
  assert.match(css, /body\.messages-mobile-thread \.messages-pane__lead/);
  assert.match(css, /body\.messages-shell-open[\s\S]*\.drawer-toggle/);
  assert.match(css, /display:\s*none\s*!important/);
  assert.match(css, /body\.messages-mobile-thread \.messages-pane__links[^}]*padding-left:\s*54px/);
  // No slide-over drawer when a thread is open.
  assert.equal(/messages-mobile-thread\[data-drawer-open\][\s\S]*translateX\(0\)/.test(css), false);
  const drawer = fs.readFileSync(path.join(__dirname, "..", "src/renderer/mobile-drawer.js"), "utf8");
  assert.match(drawer, /inboxOwnsScreen/);
  assert.equal(/data-messages-menu/.test(drawer), false);
  assert.equal(/syncHeaderMenu/.test(drawer), false);
});
