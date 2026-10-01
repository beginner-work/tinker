/* Person interview-prep stepper: one pending question, remaining queue. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const prep = require("../api/_lib/person-prep.js");

const MALAY = [
  "Interview link: https://air.usebraintrust.com/i/379/8200",
  "Malay said both AI interviews fit in about an hour.",
  "",
  "### Tell me about yourself. Why the Destinations team at Hightouch?",
  "",
  "",
  "### Destinations owns 300+ partner integrations. How do you keep that many reliable when partner APIs change under you?",
  "",
  "",
  "### Tell me about a time you grew or turned around a team.",
  "",
].join("\n");

test("parsePersonPrep shows one pending and queues the rest", () => {
  const parsed = prep.parsePersonPrep(MALAY);
  assert.match(parsed.preamble, /Interview link/);
  assert.equal(parsed.transcript.length, 0);
  assert.equal(parsed.pending, "Tell me about yourself. Why the Destinations team at Hightouch?");
  assert.equal(parsed.queue.length, 2);
  assert.equal(parsed.done, false);
  assert.equal(prep.shapePersonPrep(parsed).remaining, 3);
});

test("serializePersonPrep round-trips queue without dropping later questions", () => {
  const parsed = prep.parsePersonPrep(MALAY);
  const out = prep.serializePersonPrep(
    parsed.preamble,
    parsed.transcript,
    parsed.pending,
    "",
    parsed.queue
  );
  const again = prep.parsePersonPrep(out);
  assert.equal(again.pending, parsed.pending);
  assert.deepEqual(again.queue, parsed.queue);
  assert.match(again.preamble, /Interview link/);
});

test("seedPersonPrepQuestions appends without wiping answers", () => {
  const existing = [
    "### First question?",
    "An answer",
    "",
    "### Second queued?",
    "",
  ].join("\n");
  const notes = prep.seedPersonPrepQuestions(existing, ["Second queued?", "Third new?"]);
  const parsed = prep.parsePersonPrep(notes);
  assert.equal(parsed.transcript.length, 1);
  assert.equal(parsed.transcript[0].a, "An answer");
  assert.equal(parsed.pending, "Second queued?");
  assert.deepEqual(parsed.queue, ["Third new?"]);
});

test("composer contract: queue advance without model when seeded", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const js = fs.readFileSync(path.join(__dirname, "../src/renderer/messages-composer.js"), "utf8");
  assert.match(js, /state\.queue/);
  assert.match(js, /Seeded prep queue advances/);
  assert.match(js, /unanswered\.slice\(1\)/);
  assert.match(js, /serializeNotes\(state\.preamble/);
});

test("prep preamble stays out of the thread UI but reaches Keep crafting prompts", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const js = fs.readFileSync(path.join(__dirname, "../src/renderer/messages-composer.js"), "utf8");
  const opening = js.match(/function buildOpening\([\s\S]*?return opening;\n  \}/);
  assert.ok(opening, "buildOpening present");
  assert.equal(/appendChild\(preamble\)/.test(opening[0]), false);
  assert.equal(/messages-notepad__section/.test(opening[0]), false);
  // #416 labels prep as light background; fallback and interview-prompt both keep it.
  assert.match(js, /Prep context(?: \(light background only\))?:/);
  assert.match(js, /prepContext\.slice\(0,\s*1200\)|prepContext/);
  // Serialization still keeps preamble in stored notes for MCP / prompts.
  assert.match(js, /serializeNotes\(state\.preamble/);
  const thread = fs.readFileSync(path.join(__dirname, "../src/renderer/messages-thread.js"), "utf8");
  assert.match(thread, /postingUrl/);
  assert.match(thread, /Job posting/);
});
