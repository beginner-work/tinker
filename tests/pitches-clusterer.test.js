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
