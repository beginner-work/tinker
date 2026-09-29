/* TYL-55 passage/excerpt helpers for selling parts. */
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
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
