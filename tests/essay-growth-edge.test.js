/* Growth-edge concept tagging + starting-essay selection. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const growth = require("../src/renderer/lib/essay-growth-edge.js");
const models = require("../src/renderer/lib/claude-models.js");
const structured = require("../src/renderer/lib/claude-structured.js");

const html = fs.readFileSync(
  path.join(root, "src/renderer/repo/index.html"),
  "utf8"
);
const page = fs.readFileSync(
  path.join(root, "src/renderer/repo/repo.js"),
  "utf8"
);
const css = fs.readFileSync(
  path.join(root, "src/renderer/repo/repo.css"),
  "utf8"
);
const harness = fs.readFileSync(
  path.join(root, "src/renderer/repo/harness/growth-edge-start.html"),
  "utf8"
);

const longBody =
  "I keep returning to how I ship. The cadence slips when I wait for " +
  "perfect framing, and the essay only lands when I cut the scope again.";

/** Fixture essays used for selection tests and the starting-screen report. */
const FIXTURE_ESSAYS = [
  {
    id: "e_ship_1",
    title: "Cut the scope",
    body: longBody,
    updatedAt: "2026-10-10T12:00:00.000Z",
    growthConcepts: ["Shipping Cadence", "Scope Cutting"],
  },
  {
    id: "e_ship_2",
    title: "Ship the next cut",
    body: longBody,
    updatedAt: "2026-10-14T09:00:00.000Z",
    growthConcepts: ["Shipping Cadence"],
  },
  {
    id: "e_cust_1",
    title: "Talk to three",
    body: longBody,
    updatedAt: "2026-10-15T18:00:00.000Z",
    growthConcepts: ["Customer Conversations"],
  },
  {
    id: "e_ship_3",
    title: "Cadence holds",
    body: longBody,
    // Most recent Shipping Cadence essay (and overall most recent of the
    // winning concept). Expected starting essay on this fixture set.
    updatedAt: "2026-10-16T08:30:00.000Z",
    growthConcepts: ["Shipping Cadence", "Writing Clarity"],
  },
];

test("essay-growth-edge pins Haiku 4.5 via ESSAY_GROWTH_EDGE", () => {
  assert.equal(models.ESSAY_GROWTH_EDGE, models.FAST);
  assert.equal(models.ESSAY_GROWTH_EDGE, "claude-haiku-4-5-20251001");
  assert.equal(growth.MODEL, models.ESSAY_GROWTH_EDGE);
  assert.ok(growth.MIN_CHARS >= 40);
  assert.equal(growth.MAX_CONCEPTS, 5);
});

test("normalizeConcept title-cases, strips dashes, bans free/real/quietly", () => {
  assert.equal(growth.normalizeConcept("shipping cadence"), "Shipping Cadence");
  assert.equal(growth.normalizeConcept("Customer — Conversations"), "Customer Conversations");
  assert.equal(growth.normalizeConcept("free writing"), "");
  assert.equal(growth.normalizeConcept("real talk"), "");
  assert.equal(growth.normalizeConcept("quietly shipping"), "");
  assert.deepEqual(
    growth.normalizeConcepts(["shipping cadence", "Shipping Cadence", "free pass"]),
    ["Shipping Cadence"]
  );
});

test("needsConceptTag caches by body hash and re-tags on change", () => {
  const hash = growth.bodyHash(longBody);
  assert.equal(growth.needsConceptTag(null), false);
  assert.equal(growth.needsConceptTag({ body: "short" }), false);
  assert.equal(growth.needsConceptTag({ body: longBody }), true);
  assert.equal(
    growth.needsConceptTag({
      body: longBody,
      growthConcepts: ["Shipping Cadence"],
      growthConceptsTaggedAt: "2026-10-01T00:00:00.000Z",
      growthConceptsBodyHash: hash,
    }),
    false
  );
  assert.equal(
    growth.needsConceptTag({
      body: longBody + " Changed.",
      growthConcepts: ["Shipping Cadence"],
      growthConceptsTaggedAt: "2026-10-01T00:00:00.000Z",
      growthConceptsBodyHash: hash,
    }),
    true
  );
});

test("tagEssayConcepts uses mocked callFn and returns concepts", async () => {
  let sawModel = null;
  const result = await growth.tagEssayConcepts({
    text: longBody,
    structuredApi: structured,
    callFn: async (payload) => {
      sawModel = payload.model;
      return {
        text: "",
        toolUse: {
          name: "submit_growth_concepts",
          input: { concepts: ["shipping cadence", "free writing"] },
        },
      };
    },
  });
  assert.deepEqual(result.concepts, ["Shipping Cadence"]);
  assert.equal(result.skipped, false);
  assert.equal(sawModel, models.ESSAY_GROWTH_EDGE);
  assert.equal(result.bodyHash, growth.bodyHash(longBody));
});

test("tagEssayConcepts skips short text without calling Claude", async () => {
  let called = 0;
  const result = await growth.tagEssayConcepts({
    text: "too short",
    structuredApi: structured,
    callFn: async () => {
      called += 1;
      return { text: "{}" };
    },
  });
  assert.equal(result.skipped, true);
  assert.deepEqual(result.concepts, []);
  assert.equal(called, 0);
});

test("selectGrowthEdge returns null for empty or untagged essays", () => {
  assert.equal(growth.selectGrowthEdge([]), null);
  assert.equal(growth.selectGrowthEdge(null), null);
  assert.equal(
    growth.selectGrowthEdge([{ id: "e1", body: longBody, growthConcepts: [] }]),
    null
  );
  assert.equal(
    growth.selectGrowthEdge([{ id: "e1", body: longBody }]),
    null
  );
});

test("selectGrowthEdge picks the concept with the most essays", () => {
  const pick = growth.selectGrowthEdge(FIXTURE_ESSAYS);
  assert.ok(pick);
  // Shipping Cadence appears in 3 essays; Customer Conversations in 1.
  assert.equal(pick.concept, "Shipping Cadence");
  assert.equal(pick.count, 3);
  assert.equal(pick.essayId, "e_ship_3");
  assert.equal(pick.essay.title, "Cadence holds");
});

test("selectGrowthEdge tie-breaks by most recent occurrence", () => {
  const tied = [
    {
      id: "a1",
      updatedAt: "2026-10-10T00:00:00.000Z",
      growthConcepts: ["Alpha Path"],
    },
    {
      id: "b1",
      updatedAt: "2026-10-11T00:00:00.000Z",
      growthConcepts: ["Beta Path"],
    },
    {
      id: "a2",
      updatedAt: "2026-10-12T00:00:00.000Z",
      growthConcepts: ["Alpha Path"],
    },
    {
      id: "b2",
      // Beta's latest occurrence is more recent → wins the tie.
      updatedAt: "2026-10-13T00:00:00.000Z",
      growthConcepts: ["Beta Path"],
    },
  ];
  const pick = growth.selectGrowthEdge(tied);
  assert.equal(pick.concept, "Beta Path");
  assert.equal(pick.count, 2);
  assert.equal(pick.essayId, "b2");
});

test("selectGrowthEdge opens the most recent essay for the winning concept", () => {
  const pick = growth.selectGrowthEdge(FIXTURE_ESSAYS);
  assert.equal(pick.essayId, "e_ship_3");
  const olderOnly = FIXTURE_ESSAYS.filter((e) => e.id !== "e_ship_3");
  const olderPick = growth.selectGrowthEdge(olderOnly);
  assert.equal(olderPick.concept, "Shipping Cadence");
  assert.equal(olderPick.essayId, "e_ship_2");
});

test("write page loads growth-edge module and quiet starting label", () => {
  assert.match(html, /essay-growth-edge\.js/);
  assert.match(html, /id="repo-growth-edge"/);
  assert.match(css, /\.repo-growth-edge\s*\{/);
  assert.match(page, /maybeOpenGrowthEdgeStart|backfillGrowthEdgeConcepts/);
  assert.match(page, /tinkerEssayGrowthEdge/);
  assert.match(page, /growthConceptsTaggedAt/);
  assert.match(page, /growthConceptsBodyHash/);
  assert.doesNotMatch(html, /\u2014|\u2013/);
  assert.doesNotMatch(html, /\bfree\b/i);
  assert.doesNotMatch(html, /\bquietly\b/i);
  assert.doesNotMatch(html, />[^<]*\breal\b[^<]*</i);
});

test("growth-edge starting harness shows concept label + read view", () => {
  assert.match(harness, /repo-growth-edge/);
  assert.match(harness, /Shipping Cadence/);
  assert.match(harness, /Cadence Holds/);
  assert.match(harness, /repo-surface--reading/);
  assert.match(harness, /essay-read__prose/);
  assert.doesNotMatch(harness, /\u2014|\u2013/);
  assert.doesNotMatch(harness, /\bfree\b/i);
  assert.doesNotMatch(harness, /\bquietly\b/i);
});

module.exports = { FIXTURE_ESSAYS };
