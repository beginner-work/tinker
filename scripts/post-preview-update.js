#!/usr/bin/env node
/**
 * Post the Browserbase walkthrough results back to the PR.
 *
 * Reads artifacts/summary.json (and the screenshots it references),
 * pushes the PNGs to a long-lived `previews` branch under
 * `pr-<N>/<flow>.png`, then rewrites the sentinel-delimited section in
 * the PR description so the images render inline at the top of the PR.
 *
 * The `previews` branch is created on first run (orphan, no history
 * shared with main). Subsequent PRs add new directories; subsequent
 * deploys of the same PR overwrite that PR's directory. Old PR
 * directories can be pruned independently — nothing else in the repo
 * depends on this branch.
 *
 * Env (required):
 *   GITHUB_TOKEN        token with contents:write + pull-requests:write
 *   GITHUB_REPOSITORY   owner/repo (auto-set in Actions)
 *   PR_NUMBER           PR to update
 *
 * Env (optional):
 *   ARTIFACTS_DIR       default ./artifacts
 *   PREVIEWS_BRANCH     default "previews"
 *
 * Pre-requisite: the working directory is a git checkout of the repo
 * with credentials configured (the Actions runner gets this for free).
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SENTINEL_START = "<!-- tinker-preview-bot:start -->";
const SENTINEL_END = "<!-- tinker-preview-bot:end -->";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function git(args, opts = {}) {
  return execFileSync("git", args, {
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    ...opts,
  }).trim();
}

async function ghFetch(token, urlPath, init = {}) {
  const res = await fetch(`https://api.github.com${urlPath}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "tinker-preview-bot",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${init.method || "GET"} ${urlPath} -> ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pushWithRetry(cwd, branch) {
  let attempt = 0;
  while (true) {
    try {
      execFileSync("git", ["push", "-u", "origin", branch], {
        cwd,
        stdio: "inherit",
      });
      return;
    } catch (err) {
      attempt++;
      if (attempt >= 4) throw err;
      const delayMs = 2000 * Math.pow(2, attempt - 1);
      console.log(`push failed (attempt ${attempt}/4), retrying in ${delayMs}ms`);
      await sleep(delayMs);
    }
  }
}

async function publishScreenshots({ branch, prNumber, summary, artifactsDir }) {
  const flows = summary.flows.filter((f) => f.screenshot);
  if (flows.length === 0) return [];

  // Use a sibling worktree so we don't disturb the checkout the
  // walkthrough ran against. Lives in a tmp path so the runner's
  // post-job checkout cleanup leaves it alone.
  const worktree = path.resolve("/tmp", `tinker-previews-${process.pid}`);
  fs.rmSync(worktree, { recursive: true, force: true });

  // Bot identity for the commit. Scoped to the main checkout (not
  // --global) so we don't leak it into a shared environment.
  git(["config", "user.name", "github-actions[bot]"]);
  git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);

  const remoteHasBranch =
    git(["ls-remote", "--heads", "origin", branch]).length > 0;
  if (remoteHasBranch) {
    git(["fetch", "origin", `${branch}:refs/remotes/origin/${branch}`, "--depth=1"]);
    git(["worktree", "add", "-B", branch, worktree, `origin/${branch}`]);
  } else {
    // `--orphan` creates a worktree on a new branch with an empty
    // index — no inheritance from HEAD. Requires git ≥ 2.42 (every
    // ubuntu-latest runner ships a newer one).
    git(["worktree", "add", "--orphan", "-b", branch, worktree]);
  }

  const prDir = path.join(worktree, `pr-${prNumber}`);
  fs.rmSync(prDir, { recursive: true, force: true });
  fs.mkdirSync(prDir, { recursive: true });

  const published = [];
  for (const flow of flows) {
    const src = path.join(artifactsDir, flow.screenshot);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(prDir, path.basename(flow.screenshot));
    fs.copyFileSync(src, dest);
    published.push({
      flow: flow.name,
      file: path.relative(worktree, dest).replace(/\\/g, "/"),
    });
  }

  fs.writeFileSync(
    path.join(prDir, "README.md"),
    `Browserbase preview screenshots for PR #${prNumber}.\n` +
      `Generated ${summary.generatedAt}. Commit ${summary.commit || "unknown"}.\n` +
      `Regenerated on every preview deploy.\n`,
  );

  git(["add", "."], { cwd: worktree });
  let hasChanges = false;
  try {
    execFileSync("git", ["diff", "--cached", "--quiet"], {
      cwd: worktree,
      stdio: "ignore",
    });
  } catch {
    hasChanges = true;
  }

  if (hasChanges) {
    git(["commit", "-m", `Update preview screenshots for PR #${prNumber}`], {
      cwd: worktree,
    });
    await pushWithRetry(worktree, branch);
  } else {
    console.log("[preview-bot] no changes to push");
  }

  try {
    execFileSync("git", ["worktree", "remove", "--force", worktree], {
      stdio: "ignore",
    });
  } catch {
    // Best-effort cleanup; the worktree is in /tmp anyway.
  }

  return published;
}

function renderSection({ summary, published, repo, branch }) {
  const lines = [];
  lines.push(SENTINEL_START);
  lines.push("");
  lines.push("## Preview walkthrough");
  lines.push("");
  lines.push(`Preview: ${summary.previewUrl}`);
  lines.push("");
  lines.push(
    `Browserbase session: [view replay](${summary.inspectorUrl}) · ` +
      `generated ${summary.generatedAt}`,
  );
  lines.push("");

  const byName = new Map(published.map((p) => [p.flow, p]));
  const ok = summary.flows.filter((f) => f.status === "ok");
  const skipped = summary.flows.filter((f) => f.status === "skipped");
  const failed = summary.flows.filter((f) => f.status === "failed");

  if (failed.length > 0) {
    lines.push(`### ${failed.length} flow(s) failed`);
    for (const flow of failed) {
      lines.push(`- **${flow.name}**: ${flow.error || "unknown error"}`);
    }
    lines.push("");
  }

  if (skipped.length > 0) {
    lines.push("### Skipped");
    for (const flow of skipped) {
      lines.push(`- **${flow.name}** — ${flow.skipReason || "skipped"}`);
    }
    lines.push("");
  }

  if (ok.length > 0 || failed.length > 0) {
    lines.push("### Screenshots");
    lines.push("");
    for (const flow of [...ok, ...failed]) {
      const pub = byName.get(flow.name);
      lines.push(
        `<details><summary><strong>${flow.name}</strong> — ${flow.description || ""}</summary>`,
      );
      lines.push("");
      if (pub) {
        // ts query param busts the raw.githubusercontent CDN cache when
        // the same path is overwritten by a later preview deploy.
        const rawUrl =
          `https://raw.githubusercontent.com/${repo}/${branch}/${pub.file}` +
          `?ts=${encodeURIComponent(summary.generatedAt)}`;
        lines.push(`<img src="${rawUrl}" alt="${flow.name}" width="800" />`);
        lines.push("");
      } else {
        lines.push("_(no screenshot captured)_");
        lines.push("");
      }
      const errors = (flow.events || []).filter(
        (e) => e.level === "error" || e.kind === "pageerror",
      );
      const warnings = (flow.events || []).filter(
        (e) => e.level === "warning" || e.kind === "requestfailed",
      );
      if (errors.length > 0 || warnings.length > 0) {
        lines.push("");
        lines.push("Browser console:");
        lines.push("");
        lines.push("```");
        for (const e of errors.slice(0, 10)) {
          lines.push(`[${e.level}] ${e.text}`);
        }
        for (const w of warnings.slice(0, 10)) {
          lines.push(`[${w.level}] ${w.text}`);
        }
        if (errors.length + warnings.length > 20) {
          lines.push(
            `… and ${errors.length + warnings.length - 20} more (see workflow logs)`,
          );
        }
        lines.push("```");
      }
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }

  lines.push(SENTINEL_END);
  return lines.join("\n");
}

function mergeIntoBody(existingBody, section) {
  const body = existingBody || "";
  const startIdx = body.indexOf(SENTINEL_START);
  const endIdx = body.indexOf(SENTINEL_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return (
      body.slice(0, startIdx) +
      section +
      body.slice(endIdx + SENTINEL_END.length)
    );
  }
  const separator = body && !body.endsWith("\n") ? "\n\n" : "\n";
  return body + separator + section + "\n";
}

async function main() {
  const token = requireEnv("GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY");
  const prNumber = Number(requireEnv("PR_NUMBER"));
  const artifactsDir = path.resolve(process.env.ARTIFACTS_DIR || "artifacts");
  const branch = process.env.PREVIEWS_BRANCH || "previews";

  const summaryPath = path.join(artifactsDir, "summary.json");
  if (!fs.existsSync(summaryPath)) {
    console.error(`No summary at ${summaryPath} — did the walkthrough run?`);
    process.exit(1);
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  summary.prNumber = prNumber;

  console.log(
    `[preview-bot] publishing ${summary.flows.length} flow(s) for PR #${prNumber}`,
  );

  const published = await publishScreenshots({
    branch,
    prNumber,
    summary,
    artifactsDir,
  });

  const section = renderSection({ summary, published, repo, branch });

  const pr = await ghFetch(token, `/repos/${repo}/pulls/${prNumber}`);
  const newBody = mergeIntoBody(pr.body, section);
  if (newBody === pr.body) {
    console.log("[preview-bot] PR body unchanged");
    return;
  }
  await ghFetch(token, `/repos/${repo}/pulls/${prNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ body: newBody }),
  });
  console.log("[preview-bot] PR body updated");
}

// Pure helpers are exported for unit tests; main() only runs when the
// file is invoked directly.
module.exports = {
  renderSection,
  mergeIntoBody,
  SENTINEL_START,
  SENTINEL_END,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
