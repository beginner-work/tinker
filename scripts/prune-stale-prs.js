#!/usr/bin/env node
/**
 * Prune stale pull requests.
 *
 * Closes any open PR whose last activity (`updated_at`) is older than
 * STALE_THRESHOLD_DAYS calendar days.
 *
 * Env:
 *   GITHUB_TOKEN       required — token with `pull-requests: write` + `issues: write`
 *   GITHUB_REPOSITORY  required — `owner/repo` (set automatically in GitHub Actions)
 *   DRY_RUN=true       optional — log stale PRs without closing
 *
 * Flags:
 *   --dry-run          same as DRY_RUN=true
 */

const STALE_THRESHOLD_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const STALE_THRESHOLD_MS = STALE_THRESHOLD_DAYS * MS_PER_DAY;

async function githubFetch(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'beginner-prune-stale-prs',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${method} ${path} -> ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function listOpenPRs({ repo, token }) {
  const prs = [];
  let page = 1;
  while (true) {
    const pageData = await githubFetch(
      `/repos/${repo}/pulls?state=open&per_page=100&page=${page}`,
      { token },
    );
    prs.push(...pageData);
    if (pageData.length < 100) break;
    page++;
  }
  return prs;
}

function buildComment(days) {
  return (
    `Closing automatically: no activity in ${days.toFixed(1)} days ` +
    `(threshold **${STALE_THRESHOLD_DAYS} days**). ` +
    `Reopen this PR if you'd like to continue the work.`
  );
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const dryRun = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');

  if (!token) {
    console.error('GITHUB_TOKEN env var is required.');
    process.exit(1);
  }
  if (!repo) {
    console.error('GITHUB_REPOSITORY env var is required.');
    process.exit(1);
  }

  const now = Date.now();
  console.log(
    `[prune-stale-prs] ${new Date(now).toISOString()} | repo=${repo} threshold=${STALE_THRESHOLD_DAYS}d${dryRun ? ' (dry-run)' : ''}`,
  );

  const prs = await listOpenPRs({ repo, token });
  console.log(`[prune-stale-prs] Found ${prs.length} open PR(s).`);

  let closed = 0;
  for (const pr of prs) {
    const ageMs = now - new Date(pr.updated_at).getTime();
    const ageDays = ageMs / MS_PER_DAY;
    const tag = `#${pr.number} ${pr.user.login.padEnd(16)} updated=${pr.updated_at} age_days=${ageDays.toFixed(2)}`;

    if (ageMs < STALE_THRESHOLD_MS) {
      console.log(`  KEEP  ${tag}`);
      continue;
    }

    console.log(`  STALE ${tag}`);
    if (dryRun) continue;

    await githubFetch(`/repos/${repo}/issues/${pr.number}/comments`, {
      method: 'POST',
      token,
      body: { body: buildComment(ageDays) },
    });
    await githubFetch(`/repos/${repo}/pulls/${pr.number}`, {
      method: 'PATCH',
      token,
      body: { state: 'closed' },
    });
    console.log(`    -> closed #${pr.number}`);
    closed++;
  }

  console.log(`[prune-stale-prs] Done. Closed ${closed} PR(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
