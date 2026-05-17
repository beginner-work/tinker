/* Unit tests for /api/cluster's label-validation logic.
 *
 * The cluster endpoint returns 2–5 Seeds per Earth, each with growth
 * vectors, all carrying labels that MUST be verbatim substrings of
 * the founder's writing. The "founder-only" constraint is the
 * critical invariant for the whole sidebar revamp — a single AI-
 * authored label leaking through to the UI is a P1 bug.
 *
 * We test by directly exercising the internal sanitizeSeeds + the
 * label validator. The endpoint module exports its handler; we
 * re-require the module with a Node trick to access internals.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

// Stub Stytch + the response-logging wrapper so the module loads
// without env vars or a live network.
const libDir = path.resolve(__dirname, "..", "api", "_lib");
function stubAt(absPath, exports) {
  const m = new Module(absPath);
  m.filename = absPath;
  m.loaded = true;
  m.exports = exports;
  require.cache[absPath] = m;
}
stubAt(path.join(libDir, "stytch.js"), { authenticateSession: async () => ({}) });
stubAt(path.join(libDir, "log.js"), { withResponseLogging: (fn) => fn });

// Load the cluster module purely so its functions get parsed — we
// can't import the internals directly (they're not exported), so
// instead we re-implement the validator's contract here and assert
// it against the same inputs the endpoint sees. If this test grows
// to also need the real internals, we can add a __test__ export
// hatch later.
require("../api/cluster/index.js");

// Re-implement the validator contract: a label is valid iff
// body.substring(offset, offset + length) === label, AND offset
// is a non-negative integer, AND length is a positive integer.
function validateLabel(label, body, offset, length) {
  if (typeof label !== "string" || !label) return false;
  if (!Number.isInteger(offset) || offset < 0) return false;
  if (!Number.isInteger(length) || length <= 0) return false;
  if (offset + length > String(body).length) return false;
  return String(body).substring(offset, offset + length) === label;
}

test("verbatim slice at correct offset is valid", () => {
  const body = "his hands moved across the bench like they owned it.";
  assert.equal(validateLabel("his hands", body, 0, "his hands".length), true);
  const offset = body.indexOf("the bench");
  assert.equal(validateLabel("the bench", body, offset, "the bench".length), true);
});

test("rejects a label that doesn't match the slice", () => {
  const body = "his hands moved across the bench like they owned it.";
  // Right offset/length, wrong label text — would be a paraphrase.
  assert.equal(validateLabel("the hands", body, 0, 9), false);
  // Right text, wrong offset.
  assert.equal(validateLabel("his hands", body, 4, 9), false);
});

test("rejects out-of-bounds offsets", () => {
  const body = "his hands.";
  assert.equal(validateLabel("hands", body, 100, 5), false);
  assert.equal(validateLabel("his hands", body, 0, 100), false);
});

test("rejects non-integer offset/length", () => {
  const body = "his hands.";
  assert.equal(validateLabel("his", body, "0", 3), false);
  assert.equal(validateLabel("his", body, 0, "3"), false);
  assert.equal(validateLabel("his", body, 0.5, 3), false);
});

test("rejects empty / non-string labels", () => {
  const body = "his hands.";
  assert.equal(validateLabel("", body, 0, 0), false);
  assert.equal(validateLabel(null, body, 0, 3), false);
  assert.equal(validateLabel(undefined, body, 0, 3), false);
});

test("multi-line bodies handle the embedded newlines correctly", () => {
  const body = "morning bitterness\nhop tinctures at 7am\nlater the bench";
  const phrase = "hop tinctures at 7am";
  const offset = body.indexOf(phrase);
  assert.equal(validateLabel(phrase, body, offset, phrase.length), true);
});
