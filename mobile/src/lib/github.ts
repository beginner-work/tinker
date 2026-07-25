/* GitHub repo link + essay → pull request.
 *
 * The founder connects a personal access token (repo scope) and a target
 * repository before writing. When an essay publishes, we open a branch,
 * commit a markdown file, and open a PR. Token stays in SecureStore on
 * device — never in TinkerUserData.
 */

import * as SecureStore from "expo-secure-store";
import type { Essay } from "../api/userData";

const CONFIG_KEY = "tinker_github_config_v1";
const TOKEN_KEY = "tinker_github_token_v1";

export type GitHubConfig = {
  owner: string;
  repo: string;
  defaultBranch: string;
  /** e.g. essays/{slug}.md — {slug} {id} {yyyy} {mm} {dd} */
  pathTemplate: string;
  login?: string;
  connectedAt: number;
};

export type EssayPullRequest = {
  prUrl: string;
  prNumber: number;
  branch: string;
  path: string;
};

function parseRepoInput(raw: string): { owner: string; repo: string } {
  const cleaned = raw
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("Use owner/repo — for example beginner-work/essays.");
  }
  return { owner: parts[0], repo: parts[1] };
}

export async function getGitHubToken(): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(TOKEN_KEY)) || "";
  } catch {
    return "";
  }
}

export async function getGitHubConfig(): Promise<GitHubConfig | null> {
  try {
    const raw = await SecureStore.getItemAsync(CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GitHubConfig;
    if (!parsed?.owner || !parsed?.repo) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function isGitHubConnected(): Promise<boolean> {
  const [token, config] = await Promise.all([
    getGitHubToken(),
    getGitHubConfig(),
  ]);
  return !!(token && config?.owner && config?.repo);
}

export async function clearGitHubConnection(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(CONFIG_KEY);
  } catch {
    // ignore
  }
}

async function gh<T>(
  token: string,
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    method: opts.method || "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "tinker-expo",
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // empty
  }
  if (!res.ok) {
    const msg =
      json?.message ||
      (res.status === 401
        ? "GitHub token was rejected — check the PAT."
        : `GitHub request failed (${res.status})`);
    throw new Error(msg);
  }
  return json as T;
}

/** Validate token + repo and persist the connection. */
export async function connectGitHubRepo(input: {
  token: string;
  repo: string;
  pathTemplate?: string;
}): Promise<GitHubConfig> {
  const token = input.token.trim();
  if (!token) throw new Error("Paste a GitHub personal access token.");
  const { owner, repo } = parseRepoInput(input.repo);

  const user = await gh<{ login: string }>(token, "/user");
  const repoInfo = await gh<{
    default_branch: string;
    full_name: string;
    permissions?: { push?: boolean };
  }>(token, `/repos/${owner}/${repo}`);

  if (repoInfo.permissions && repoInfo.permissions.push === false) {
    throw new Error(
      "That token can read the repo but not push — need write access.",
    );
  }

  const config: GitHubConfig = {
    owner,
    repo,
    defaultBranch: repoInfo.default_branch || "main",
    pathTemplate: (input.pathTemplate || "essays/{slug}.md").trim(),
    login: user.login,
    connectedAt: Date.now(),
  };

  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(config));
  return config;
}

function applyPathTemplate(
  template: string,
  essay: Essay,
): string {
  const d = new Date(essay.createdAt || Date.now());
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return template
    .replaceAll("{slug}", essay.slug || essay.id)
    .replaceAll("{id}", essay.id)
    .replaceAll("{yyyy}", yyyy)
    .replaceAll("{mm}", mm)
    .replaceAll("{dd}", dd)
    .replace(/^\/+/, "");
}

function essayMarkdown(essay: Essay): string {
  const title = essay.title || "Untitled";
  const body = (essay.body || "").trim();
  const when = new Date(essay.createdAt || Date.now()).toISOString().slice(0, 10);
  const seed = essay.seed ? `\n_Place: ${essay.seed}_\n` : "\n";
  return `# ${title}\n${seed}\n${body}\n\n---\n\nPublished from [tinker](https://tinker-theta.vercel.app) on ${when}.\n`;
}

function toBase64(text: string): string {
  // React Native has global btoa in Hermes / modern JSC; fall back for safety.
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(text)));
  }
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  // eslint-disable-next-line no-undef
  return globalThis.btoa(binary);
}

/** Open a branch, commit the essay markdown, and create a pull request. */
export async function createEssayPullRequest(
  essay: Essay,
): Promise<EssayPullRequest> {
  const token = await getGitHubToken();
  const config = await getGitHubConfig();
  if (!token || !config) {
    throw new Error("Connect a GitHub repo before publishing.");
  }

  const { owner, repo, defaultBranch, pathTemplate } = config;
  const path = applyPathTemplate(pathTemplate, essay);
  const short = (essay.id || "essay").replace(/^e_/, "").slice(0, 8);
  const branch = `tinker/${(essay.slug || short).slice(0, 48)}-${short}`
    .replace(/[^a-zA-Z0-9._\-/]/g, "-")
    .replace(/-+/g, "-");

  const ref = await gh<{ object: { sha: string } }>(
    token,
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
  );
  const baseSha = ref.object.sha;

  // Create branch (ignore if it already exists).
  try {
    await gh(token, `/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${branch}`, sha: baseSha },
    });
  } catch (e: any) {
    if (!/already exists/i.test(e?.message || "")) throw e;
  }

  // If the file already exists on the branch, send its sha to update.
  let existingSha: string | undefined;
  try {
    const existing = await gh<{ sha: string }>(
      token,
      `/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`,
    );
    existingSha = existing.sha;
  } catch {
    // new file
  }

  const content = toBase64(essayMarkdown(essay));
  await gh(token, `/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    body: {
      message: `Add essay: ${essay.title || essay.slug}`,
      content,
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
    },
  });

  const pr = await gh<{ html_url: string; number: number }>(
    token,
    `/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      body: {
        title: essay.title || "Untitled essay",
        head: branch,
        base: defaultBranch,
        body: [
          essay.body?.slice(0, 500) || "",
          "",
          "---",
          `Opened automatically from tinker after publishing \`${essay.id}\`.`,
          `File: \`${path}\``,
        ].join("\n"),
      },
    },
  );

  return {
    prUrl: pr.html_url,
    prNumber: pr.number,
    branch,
    path,
  };
}

export function repoLabel(config: GitHubConfig | null): string {
  if (!config) return "";
  return `${config.owner}/${config.repo}`;
}
