#!/usr/bin/env node
// PlanetScale + git branch pruning logic for
// .github/workflows/planetscale-branch-pruning.yml.
//
// This is a deliberate port of beginner/scripts/neon-prune.mjs: the org
// previously ate a ~$300 bill from orphaned preview DB branches, and the
// fix was to split the *decision* (which branches to delete) into pure,
// unit-tested selector functions, with a thin CLI that is the only part
// that talks to GitHub / PlanetScale. Keep that split — the regression
// has a test (tests/planetscale-prune.test.js).
//
// Branch hygiene model: tinker creates one PlanetScale branch per PR,
// named `pr-<N>` (see planetscale-branch.yml). A branch survives a sweep
// iff it is the production branch, matches an *open* PR (by `pr-<N>` or by
// head ref), or is younger than the grace window. Talking to PlanetScale
// goes through the `pscale` CLI (the PlanetScale-recommended path), which
// authenticates from PLANETSCALE_SERVICE_TOKEN_ID / PLANETSCALE_SERVICE_TOKEN.
//
// Run modes (CLI):
//   node scripts/planetscale-prune.mjs close-pr   # uses $GITHUB_EVENT_PATH
//   node scripts/planetscale-prune.mjs orphans

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const GRACE_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Pure selectors — testable, no IO.
// ---------------------------------------------------------------------------

/**
 * Decide which PlanetScale branches the scheduled sweep should delete.
 *
 * Protection rule: a branch survives iff it is a production branch, matches
 * an *open* PR (by `pr-<N>` or by head ref), or is younger than the grace
 * window. Matching a stale git branch is NOT protective — that was the bug
 * the Neon version was written to fix.
 */
export function selectOrphanedBranches({
  branches,
  openHeadRefs,
  openPRNumbers,
  defaultBranch,
  now,
  graceMs = GRACE_MS,
}) {
  const openHeadSet = new Set(openHeadRefs);
  const openPRSet = new Set(openPRNumbers);
  const toDelete = [];

  for (const branch of branches) {
    if (branch.production) continue;
    if (branch.name === defaultBranch) continue;

    const createdAt = branch.created_at ? Date.parse(branch.created_at) : 0;
    if (createdAt && now - createdAt < graceMs) continue;

    const prMatch = branch.name.match(/^pr-(\d+)$/);
    const matchesOpenPR =
      openHeadSet.has(branch.name) ||
      (prMatch && openPRSet.has(parseInt(prMatch[1], 10)));

    if (matchesOpenPR) continue;
    toDelete.push(branch);
  }

  return toDelete;
}

/**
 * Decide which PlanetScale branches to delete when a PR closes. tinker names
 * its per-PR branch `pr-<N>`; we also match a branch named after the head ref
 * in case one was created by hand.
 */
export function selectClosePRTargets({ pr, branches, defaultBranch }) {
  const branchName = pr.head.ref;
  const prNumber = pr.number;

  return branches.filter(
    (b) =>
      !b.production &&
      b.name !== defaultBranch &&
      (b.name === `pr-${prNumber}` || b.name === branchName),
  );
}

// ---------------------------------------------------------------------------
// CLI — wires the selectors to GitHub + the pscale CLI.
// ---------------------------------------------------------------------------

const ORG = process.env.PLANETSCALE_ORG || 'tyler-lindow';
const DATABASE = process.env.PLANETSCALE_DATABASE || 'tinker';

function pscale(args) {
  // pscale reads PLANETSCALE_SERVICE_TOKEN_ID / PLANETSCALE_SERVICE_TOKEN
  // from the environment. Throws (non-zero exit) on failure.
  return execFileSync('pscale', args, { encoding: 'utf8' });
}

function listPlanetScaleBranches() {
  const out = pscale(['branch', 'list', DATABASE, '--org', ORG, '--format', 'json']);
  const data = JSON.parse(out);
  // Normalize to the shape the selectors expect.
  return data.map((b) => ({
    name: b.name,
    production: Boolean(b.production),
    created_at: b.created_at,
  }));
}

function deletePlanetScaleBranch(name) {
  pscale(['branch', 'delete', DATABASE, name, '--org', ORG, '--force']);
}

async function ghFetch(token, path, init = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'tinker-planetscale-prune',
      ...(init.headers || {}),
    },
  });
}

async function listOpenPRs({ token, owner, repo }) {
  const prs = [];
  let page = 1;
  while (true) {
    const res = await ghFetch(token, `/repos/${owner}/${repo}/pulls?state=open&per_page=100&page=${page}`);
    if (!res.ok) throw new Error(`GH list PRs: ${res.status} ${await res.text()}`);
    const data = await res.json();
    prs.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return prs;
}

async function getDefaultBranch({ token, owner, repo }) {
  const res = await ghFetch(token, `/repos/${owner}/${repo}`);
  if (!res.ok) throw new Error(`GH get repo: ${res.status}`);
  return (await res.json()).default_branch;
}

function readEvent() {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) throw new Error('GITHUB_EVENT_PATH not set');
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function runClosePR({ owner, repo, token, event }) {
  const pr = event.pull_request;
  if (!pr) throw new Error('event payload has no pull_request');

  const defaultBranch = await getDefaultBranch({ token, owner, repo });
  const branches = listPlanetScaleBranches();
  const targets = selectClosePRTargets({ pr, branches, defaultBranch });

  if (targets.length === 0) {
    console.log(`No PlanetScale branch to delete for PR #${pr.number} (${pr.head.ref}).`);
    return;
  }
  for (const t of targets) {
    console.log(`Deleting PlanetScale branch "${t.name}"`);
    try {
      deletePlanetScaleBranch(t.name);
    } catch (err) {
      console.warn(`  failed: ${err.message}`);
    }
  }
}

async function runOrphans({ owner, repo, token }) {
  const now = Date.now();
  const defaultBranch = await getDefaultBranch({ token, owner, repo });
  const openPRs = await listOpenPRs({ token, owner, repo });
  const openHeadRefs = openPRs
    .filter((pr) => pr.head.repo?.full_name === pr.base.repo.full_name)
    .map((pr) => pr.head.ref);
  const openPRNumbers = openPRs.map((pr) => pr.number);

  console.log(
    `Open PRs: ${openPRs.length}, protected refs: ${openHeadRefs.length}, default: ${defaultBranch}`,
  );

  const branches = listPlanetScaleBranches();
  const targets = selectOrphanedBranches({
    branches,
    openHeadRefs,
    openPRNumbers,
    defaultBranch,
    now,
  });
  console.log(`Found ${branches.length} PlanetScale branches, deleting ${targets.length}`);
  for (const t of targets) {
    console.log(`  delete PlanetScale "${t.name}"`);
    try {
      deletePlanetScaleBranch(t.name);
    } catch (err) {
      console.warn(`    failed: ${err.message}`);
    }
  }
}

async function main() {
  const cmd = process.argv[2];
  const token = process.env.GITHUB_TOKEN;
  const repoSlug = process.env.GITHUB_REPOSITORY;

  if (!token) throw new Error('GITHUB_TOKEN not set');
  if (!repoSlug) throw new Error('GITHUB_REPOSITORY not set');
  const [owner, repo] = repoSlug.split('/');

  if (cmd === 'close-pr') {
    await runClosePR({ owner, repo, token, event: readEvent() });
  } else if (cmd === 'orphans') {
    await runOrphans({ owner, repo, token });
  } else {
    throw new Error(`Unknown command: ${cmd} (expected close-pr | orphans)`);
  }
}

// Run main() iff invoked directly (not when imported by tests).
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
