/* TYL-55 passage/excerpt helpers and part-editor payload builder. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const excerpt = require("../src/renderer/selling/excerpt.js");

test("passageFromSelection returns body and sourceExcerpt", () => {
  const text = "Hello world from example.com notes.";
  const made = excerpt.passageFromSelection(text, 6, 11);
  assert.equal(made.body, "world");
  assert.equal(made.sourceExcerpt, "world");
  assert.equal(made.start, 6);
  assert.equal(made.end, 11);
});

test("prefillPart attaches source link; empty selection fails", () => {
  const text = "A proof point about shipping.";
  const pref = excerpt.prefillPart(text, 2, 12, "note", "note_1");
  assert.equal(pref.body, "proof poin");
  assert.equal(pref.sourceKind, "note");
  assert.equal(pref.sourceId, "note_1");
  assert.deepEqual(excerpt.sourceRef("none"), { sourceKind: "none", sourceId: null });
  assert.throws(() => excerpt.passageFromSelection(text, 4, 4), /Select a passage/);
  assert.throws(() => excerpt.sourceRef("note"), /sourceId/);
});

test("buildPartPayload matches the editor fields and never reads topics", () => {
  const payload = excerpt.buildPartPayload({
    title: "Store tables",
    stageKey: "proof_point",
    body: "Tables keep state.",
    concepts: "Idempotency, event_driven",
    stack: "TypeScript, Prisma",
    fields: { start: "0", number: "1", cause: "indexes", teamOrRole: "" },
    sourceExcerpt: "Tables keep state.",
    sourceKind: "none",
    sourceId: null,
    repo: "example/widget",
    path: "api/store.js",
    ref: "main",
    evidence: "api/store.js, api/keys.js",
  });
  assert.equal(payload.sourceKind, "code");
  assert.deepEqual(payload.concepts, ["Idempotency", "event_driven"]);
  assert.deepEqual(payload.stack, ["TypeScript", "Prisma"]);
  assert.deepEqual(payload.sourceRef, {
    repo: "example/widget",
    path: "api/store.js",
    ref: "main",
    evidence: ["api/store.js", "api/keys.js"],
  });
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "topics"), false);
  const scratch = excerpt.buildPartPayload({
    title: "Hook",
    stageKey: "hook",
    body: "Curious?",
    concepts: "fit",
    stack: "",
    fields: {},
    sourceExcerpt: "",
    sourceKind: "none",
  });
  assert.equal(scratch.sourceKind, "none");
  assert.deepEqual(scratch.stack, []);
  assert.deepEqual(scratch.sourceRef.evidence, []);

  const ui = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "selling", "selling.js"), "utf8");
  assert.match(ui, /buildPartPayload\s*\(/);
  assert.equal(/topics\s*:\s*split\s*\(\s*topics\.value\s*\)/.test(ui), false);
  assert.equal(/\btopics\.value\b/.test(ui), false);
});
