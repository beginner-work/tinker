/* This is everything → read-only Subject card + proposedSubject storage. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const composer = fs.readFileSync(path.join(root, "src/renderer/messages-composer.js"), "utf8");
const notepad = fs.readFileSync(path.join(root, "src/renderer/messages-notepad.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");
const interview = fs.readFileSync(path.join(root, "src/renderer/interview-prompt.js"), "utf8");
const followups = fs.readFileSync(path.join(root, "api/_lib/followups.js"), "utf8");
const leadsApi = fs.readFileSync(path.join(root, "api/leads.js"), "utf8");
const store = fs.readFileSync(path.join(root, "api/_lib/leads-store.js"), "utf8");
const mcp = fs.readFileSync(path.join(root, "api/mcp.js"), "utf8");

test("Keep crafting model lives behind one shared constant", () => {
  assert.match(interview, /KEEP_CRAFTING_MODEL\s*=\s*["']claude-opus-4-8["']/);
  assert.match(interview, /KEEP_CRAFTING_MODEL,/);
  assert.match(composer, /keepCraftingModel\(\)|KEEP_CRAFTING_MODEL/);
  assert.match(followups, /interview\.KEEP_CRAFTING_MODEL/);
});

test("subject helpers retry + deterministic fallback", () => {
  assert.match(interview, /fallbackOutreachSubject/);
  assert.match(interview, /normalizeOutreachSubject/);
  assert.match(interview, /buildSubjectUserMessage/);
  assert.match(interview, /parseSubjectResponse/);
  assert.match(interview, /SUBJECT_SYSTEM_PROMPT/);
  assert.match(composer, /resolveSubject/);
  assert.match(composer, /maxAttempts\s*=\s*3/);
  assert.match(composer, /fallbackSubject/);
  assert.match(composer, /persistProposedSubject/);
});

test("This is everything mounts a read-only Subject card (no answer/input)", () => {
  assert.match(composer, /buildSubjectCard|buildDoneOpening/);
  assert.match(composer, /data-notepad-subject/);
  assert.match(composer, /hideInput:\s*true/);
  assert.match(composer, /hideFoot:\s*true/);
  assert.match(composer, /serializeDoneNotes|__done__/);
  assert.match(notepad, /hideInput/);
  assert.match(notepad, /hideFoot/);
  assert.match(css, /\.messages-notepad__subject\b/);
  assert.match(css, /\.messages-notepad__subject-label\b/);
  // Still no editable review To/Body form.
  assert.equal(/data-review-to/.test(composer), false);
  assert.equal(/data-review-body/.test(composer), false);
  assert.equal(/approveReview/.test(composer), false);
});

test("proposed subject is stored on gmail draft and exposed to MCP readers", () => {
  assert.match(store, /async function setProposedSubject/);
  assert.match(store, /async function proposedSubjectByLeadIds/);
  assert.match(leadsApi, /proposed-subject/);
  assert.match(composer, /proposed-subject/);
  assert.match(mcp, /proposedSubject/);
  assert.match(mcp, /proposedSubjectByLeadIds/);
});

test("person path still uses callClaude (platform-mobile → converse)", () => {
  assert.match(composer, /window\.tinker\.callClaude/);
  assert.match(composer, /keepCraftingModel\(\)/);
});
