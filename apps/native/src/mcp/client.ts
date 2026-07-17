/**
 * Thin MCP hub client for repository pull/list + progress feed.
 * When EXPO_PUBLIC_MCP_URL + EXPO_PUBLIC_MCP_BEARER_TOKEN are set, calls the
 * Worker tools. Otherwise returns null so the UI uses local seeds
 * (same shapes as the hub).
 */

import type { RepoOption } from "../data/connectSeeds";
import type { ProgressEvent } from "../data/progressSeeds";

type McpToolResult = {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

function mcpConfig(): { url: string; token: string } | null {
  const url = process.env.EXPO_PUBLIC_MCP_URL?.trim();
  const token = process.env.EXPO_PUBLIC_MCP_BEARER_TOKEN?.trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown | null> {
  const cfg = mcpConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.url}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: McpToolResult };
    const text = json.result?.content?.find((c) => c.type === "text")?.text;
    if (!text || json.result?.isError) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function mapHubRepo(raw: Record<string, unknown>): RepoOption {
  const manifest = (raw.manifest as Record<string, unknown>) || {};
  const platforms = Array.isArray(manifest.platforms)
    ? (manifest.platforms as string[])
    : [];
  return {
    id: String(raw.id ?? raw.slug),
    slug: String(raw.slug),
    title: String(raw.title),
    installTool: String(raw.installTool ?? raw.install_tool ?? "repo_pull"),
    pitchSlug:
      raw.pitchSlug != null
        ? String(raw.pitchSlug)
        : raw.pitch_slug != null
          ? String(raw.pitch_slug)
          : null,
    platforms,
  };
}

/** List repositories from MCP hub, or null to fall back to seeds. */
export async function listReposFromHub(): Promise<RepoOption[] | null> {
  const data = (await callTool("repo_list", { limit: 50 })) as {
    repositories?: Record<string, unknown>[];
  } | null;
  if (!data?.repositories) return null;
  return data.repositories.map(mapHubRepo);
}

/** Pull one repo manifest from MCP hub. */
export async function pullRepoFromHub(
  slug: string,
): Promise<{ slug: string; manifest: Record<string, unknown> } | null> {
  const data = (await callTool("repo_pull", { slug })) as {
    repository?: { slug?: string };
    manifest?: Record<string, unknown>;
  } | null;
  if (!data?.manifest) return null;
  return {
    slug: String(data.repository?.slug ?? slug),
    manifest: data.manifest,
  };
}

export function isMcpConfigured(): boolean {
  return Boolean(mcpConfig());
}

/** Read progress feed from MCP hub, or null to fall back to seeds. */
export async function fetchProgressFeed(opts?: {
  limit?: number;
  owner?: string;
}): Promise<ProgressEvent[] | null> {
  const args: Record<string, unknown> = { limit: opts?.limit ?? 30 };
  if (opts?.owner) args.owner = opts.owner;
  const data = (await callTool("progress_feed", args)) as {
    events?: Array<Record<string, unknown>>;
  } | null;
  if (!data?.events || !Array.isArray(data.events)) return null;
  return data.events.map((raw) => ({
    id: String(raw.id),
    repositoryId: String(raw.repositoryId ?? raw.repository_id ?? ""),
    owner: raw.owner != null ? String(raw.owner) : null,
    kind: String(raw.kind ?? "Progress"),
    body: String(raw.body ?? ""),
    createdAt: String(raw.createdAt ?? raw.created_at ?? new Date().toISOString()),
  }));
}
