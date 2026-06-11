/* Unit tests for the shared pitch clusterer's request shaping.
 *
 * The interesting behaviour here is that the Anthropic call is pinned to
 * temperature 0 so a given corpus clusters the same way every time. We
 * stub global.fetch + the API key so the call runs in-process without
 * network.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  callClusterer,
  clusterWritings,
  nameWritings,
  CLUSTER_TEMPERATURE,
} = require("../api/_lib/pitches-clusterer.js");

// Capture the request body of the last fetch and reply with a canned
// Anthropic-shaped response carrying `text`. Restores the originals when
// the returned function is called.
function stubFetch(text) {
  const calls = [];
  const originalFetch = global.fetch;
  const originalKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-key";
  global.fetch = async (url, opts) => {
    calls.push(JSON.parse(opts.body));
    return {
      ok: true,
      json: async () => ({ content: [{ type: "text", text }] }),
    };
  };
  return {
    calls,
    restore() {
      global.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = originalKey;
    },
  };
}

test("CLUSTER_TEMPERATURE is 0 — clustering is a routing decision, not a creative one", () => {
  assert.equal(CLUSTER_TEMPERATURE, 0);
});

test("callClusterer sends temperature 0 by default", async () => {
  const f = stubFetch("hello");
  try {
    await callClusterer({ system: "sys", userMessage: "msg" });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].temperature, 0);
  } finally {
    f.restore();
  }
});

test("callClusterer honors an explicit temperature override", async () => {
  const f = stubFetch("hello");
  try {
    await callClusterer({ system: "sys", userMessage: "msg", temperature: 0.7 });
    assert.equal(f.calls[0].temperature, 0.7);
  } finally {
    f.restore();
  }
});

test("clusterWritings and nameWritings both pin temperature to 0", async () => {
  const clusterReply = JSON.stringify({
    pitches: [{
      title: "Coffee",
      writings: [{ id: "e_1", deckHeading: "The Problem", phraseText: "alpha beta gamma" }],
    }],
  });
  let f = stubFetch(clusterReply);
  try {
    await clusterWritings({
      writings: [{ id: "e_1", snippet: "alpha beta gamma delta" }],
      existingPitchTitles: [],
    });
    assert.ok(f.calls.length >= 1);
    for (const body of f.calls) assert.equal(body.temperature, 0);
  } finally {
    f.restore();
  }

  f = stubFetch(JSON.stringify({ title: "Coffee" }));
  try {
    await nameWritings({ writings: [{ id: "e_1", snippet: "alpha beta gamma" }] });
    assert.ok(f.calls.length >= 1);
    for (const body of f.calls) assert.equal(body.temperature, 0);
  } finally {
    f.restore();
  }
});

// ── Explicit topics, titles, and gather mode ─────────────────────────

test("cluster prompt carries the explicit-topic rule", () => {
  const { buildClusterPrompt, EXPLICIT_TOPIC_RULE } = require("../api/_lib/pitches-clusterer.js");
  const sys = buildClusterPrompt([]);
  assert.ok(sys.includes(EXPLICIT_TOPIC_RULE), "explicit-topic rule is in the prompt");
  assert.ok(EXPLICIT_TOPIC_RULE.includes("fundraising"), "rule names fundraising → The Ask");
  assert.ok(EXPLICIT_TOPIC_RULE.includes("The Ask"));
});

test("buildUserMessage includes the founder's title line only when present", () => {
  const { buildUserMessage } = require("../api/_lib/pitches-clusterer.js");
  const msg = buildUserMessage([
    { id: "e_1", snippet: "body one", title: "Fundraising" },
    { id: "e_2", snippet: "body two" },
  ]);
  assert.ok(msg.includes("id: e_1\ntitle: Fundraising\n---"), "titled writing carries its title line");
  assert.ok(msg.includes("id: e_2\n---"), "untitled writing has no title line");
});

test("normalizeInputs carries titles through, trimmed and capped", () => {
  const { normalizeInputs } = require("../api/_lib/pitches-clusterer.js");
  const out = normalizeInputs([
    { id: "e_1", snippet: "body", title: "  Fundraising  " },
    { id: "e_2", snippet: "body", title: "x".repeat(300) },
    { id: "e_3", snippet: "body" },
  ]);
  assert.equal(out[0].title, "Fundraising");
  assert.equal(out[1].title.length, 120);
  assert.equal(out[2].title, undefined);
});

test("gather mode prompt asks for exactly one cluster under the given title", () => {
  const { buildClusterPrompt } = require("../api/_lib/pitches-clusterer.js");
  const sys = buildClusterPrompt(["Coffee", "Growth"], { gatherTitle: "Coffee" });
  assert.ok(sys.includes('"Coffee"'), "gather title is named");
  assert.ok(sys.includes("Return exactly ONE cluster"), "single-cluster instruction present");
  assert.ok(!sys.includes("1 to 4 pitches"), "multi-pitch framing is gone");
  assert.ok(!sys.includes("Existing pitch titles:"), "existing-titles hint is dropped in gather mode");

  const multi = buildClusterPrompt(["Coffee"], { gatherTitle: null });
  assert.ok(multi.includes("1 to 4 pitches"), "without a gather title the prompt is unchanged");
});
