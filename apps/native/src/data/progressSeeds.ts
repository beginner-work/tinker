/**
 * Seed progress events for View 4 — same shape as MCP progress_feed.
 * Bodies are verbatim pitch lines or allowlisted UI strings (never model prose).
 */

import { STR } from "../strings";

export type ProgressKind = "Progress" | "Coverage" | "Connect";

/** Hub event shape from MCP `progress_feed`. */
export type ProgressEvent = {
  id: string;
  repositoryId: string;
  owner: string | null;
  kind: ProgressKind | string;
  body: string;
  createdAt: string;
};

/** Display row for LinkedIn-style cards (no source). */
export type ProgressCard = {
  id: string;
  actor: string;
  kind: string;
  body: string;
  when: string;
  repoTitle: string;
};

const NOW = Date.now();

function hoursAgo(h: number): string {
  return new Date(NOW - h * 3600_000).toISOString();
}

function daysAgo(d: number): string {
  return new Date(NOW - d * 86400_000).toISOString();
}

export const SEED_PROGRESS_EVENTS: ProgressEvent[] = [
  {
    id: "evt_seed_1",
    repositoryId: "repo_tinker",
    owner: STR.maya,
    kind: "Progress",
    body: STR.pitchTagline,
    createdAt: hoursAgo(0.2),
  },
  {
    id: "evt_seed_2",
    repositoryId: "repo_tinker",
    owner: STR.jordan,
    kind: "Coverage",
    body: STR.noSourceInFeed,
    createdAt: hoursAgo(5),
  },
  {
    id: "evt_seed_3",
    repositoryId: "repo_feed",
    owner: STR.maya,
    kind: "Connect",
    body: STR.pitchSolution,
    createdAt: daysAgo(3),
  },
  {
    id: "evt_seed_4",
    repositoryId: "repo_tinker",
    owner: STR.jordan,
    kind: "Progress",
    body: STR.pitchProblem,
    createdAt: daysAgo(6),
  },
];

/** Map ISO timestamp → allowlisted relative label. */
export function formatWhen(iso: string, nowMs = Date.now()): string {
  const ms = nowMs - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return STR.justNow;
  const hours = ms / 3600_000;
  if (hours < 1) return STR.justNow;
  if (hours < 24) return STR.today;
  if (hours < 96) return STR.days3;
  return STR.days6;
}

function kindLabel(kind: string): string {
  if (kind === "Coverage") return STR.coverage;
  if (kind === "Connect") return STR.connect;
  return STR.progress;
}

function repoTitleFor(repositoryId: string): string {
  if (repositoryId.includes("feed")) return STR.feed;
  return STR.brand;
}

export function toProgressCard(event: ProgressEvent): ProgressCard {
  return {
    id: event.id,
    actor: event.owner?.trim() || STR.brand,
    kind: kindLabel(event.kind),
    body: event.body,
    when: formatWhen(event.createdAt),
    repoTitle: repoTitleFor(event.repositoryId),
  };
}

export function cardsFromEvents(events: ProgressEvent[]): ProgressCard[] {
  return events.map(toProgressCard);
}
