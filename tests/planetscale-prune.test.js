/* Unit tests for the PlanetScale branch-pruning selectors.
 *
 * Ported from beginner/scripts/neon-prune (the "$300 orphaned-branch
 * bill" regression suite). The selectors are pure; this fixes the
 * contract that an orphaned per-PR branch gets deleted while anything
 * tied to an open PR, the production branch, or inside the grace window
 * is kept.
 *
 * planetscale-prune.mjs is ESM; we pull the selectors in via dynamic
 * import() so this CommonJS node:test file can exercise them without
 * depending on require(esm) support.
 */

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../scripts/planetscale-prune.mjs");

const NOW = Date.parse("2026-05-31T05:00:00Z");
const TWO_DAYS_AGO = NOW - 2 * 24 * 60 * 60 * 1000;
const ONE_HOUR_AGO = NOW - 60 * 60 * 1000;

const branch = (name, extra = {}) => ({
  name,
  production: false,
  created_at: new Date(TWO_DAYS_AGO).toISOString(),
  ...extra,
});

test("DELETES a pr-<N> branch when PR N is not open", async () => {
  const { selectOrphanedBranches } = await load();
  const targets = selectOrphanedBranches({
    branches: [branch("pr-42")],
    openHeadRefs: [],
    openPRNumbers: [99], // 42 not open
    defaultBranch: "main",
    now: NOW,
  });
  assert.deepEqual(targets.map((b) => b.name), ["pr-42"]);
});

test("KEEPS a pr-<N> branch when PR N is open", async () => {
  const { selectOrphanedBranches } = await load();
  const targets = selectOrphanedBranches({
    branches: [branch("pr-42")],
    openHeadRefs: [],
    openPRNumbers: [42],
    defaultBranch: "main",
    now: NOW,
  });
  assert.deepEqual(targets, []);
});

test("KEEPS a branch matching an open PR head ref", async () => {
  const { selectOrphanedBranches } = await load();
  const targets = selectOrphanedBranches({
    branches: [branch("claude/in-progress")],
    openHeadRefs: ["claude/in-progress"],
    openPRNumbers: [42],
    defaultBranch: "main",
    now: NOW,
  });
  assert.deepEqual(targets, []);
});

test("KEEPS the production branch", async () => {
  const { selectOrphanedBranches } = await load();
  const targets = selectOrphanedBranches({
    branches: [branch("main", { production: true })],
    openHeadRefs: [],
    openPRNumbers: [],
    defaultBranch: "main",
    now: NOW,
  });
  assert.deepEqual(targets, []);
});

test("KEEPS the default branch even if `production` is missing", async () => {
  const { selectOrphanedBranches } = await load();
  const targets = selectOrphanedBranches({
    branches: [branch("main")],
    openHeadRefs: [],
    openPRNumbers: [],
    defaultBranch: "main",
    now: NOW,
  });
  assert.deepEqual(targets, []);
});

test("KEEPS a branch younger than the 24h grace window", async () => {
  const { selectOrphanedBranches } = await load();
  const targets = selectOrphanedBranches({
    branches: [
      branch("pr-7", { created_at: new Date(ONE_HOUR_AGO).toISOString() }),
    ],
    openHeadRefs: [],
    openPRNumbers: [],
    defaultBranch: "main",
    now: NOW,
  });
  assert.deepEqual(targets, []);
});

test("DELETES many orphans in a single sweep", async () => {
  const { selectOrphanedBranches } = await load();
  const orphans = Array.from({ length: 250 }, (_, i) => branch(`pr-${i}`));
  const live = [branch("pr-9999"), branch("main", { production: true })];
  const targets = selectOrphanedBranches({
    branches: [...orphans, ...live],
    openHeadRefs: [],
    openPRNumbers: [9999],
    defaultBranch: "main",
    now: NOW,
  });
  assert.equal(targets.length, 250);
});

test("selectClosePRTargets targets the pr-<N> branch", async () => {
  const { selectClosePRTargets } = await load();
  const targets = selectClosePRTargets({
    pr: { number: 100, head: { ref: "claude/done" } },
    branches: [branch("pr-100"), branch("unrelated")],
    defaultBranch: "main",
  });
  assert.deepEqual(targets.map((b) => b.name), ["pr-100"]);
});

test("selectClosePRTargets also matches a branch named after the head ref", async () => {
  const { selectClosePRTargets } = await load();
  const targets = selectClosePRTargets({
    pr: { number: 100, head: { ref: "claude/done" } },
    branches: [branch("pr-100"), branch("claude/done")],
    defaultBranch: "main",
  });
  assert.deepEqual(
    targets.map((b) => b.name).sort(),
    ["claude/done", "pr-100"],
  );
});

test("selectClosePRTargets never targets the production branch", async () => {
  const { selectClosePRTargets } = await load();
  const targets = selectClosePRTargets({
    pr: { number: 1, head: { ref: "main" } },
    branches: [branch("main", { production: true })],
    defaultBranch: "main",
  });
  assert.deepEqual(targets, []);
});
