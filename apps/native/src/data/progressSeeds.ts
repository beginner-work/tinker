/**
 * Seed progress events for View 4 — same shape as hub progress_feed.
 * Feed mixes source ideas (pitch / founder words) and tech ideas (product progress).
 * Bodies are verbatim pitch lines or allowlisted UI strings (never model prose).
 */

import { STR } from "../strings";

export type ProgressKind = "Progress" | "Coverage" | "Connect";
export type IdeaLane = "source" | "tech";

/** Hub event shape from progress_feed. */
export type ProgressEvent = {
  id: string;
  repositoryId: string;
  owner: string | null;
  kind: ProgressKind | string;
  body: string;
  createdAt: string;
  /** Optional lane from hub; inferred when missing */
  lane?: IdeaLane;
};

/** Display row for LinkedIn-style cards (no source code). */
export type ProgressCard = {
  id: string;
  actor: string;
  kind: string;
  body: string;
  when: string;
  repoTitle: string;
  lane: IdeaLane;
  laneLabel: string;
};

const NOW = Date.now();

function hoursAgo(h: number): string {
  return new Date(NOW - h * 3600_000).toISOString();
}

function daysAgo(d: number): string {
  return new Date(NOW - d * 86400_000).toISOString();
}

const SOURCE_BODIES = new Set<string>([
  STR.pitchTagline,
  STR.pitchProblem,
  STR.pitchSolution,
  STR.noSourceInFeed,
  STR.yourWords,
]);

export const SEED_PROGRESS_EVENTS: ProgressEvent[] = [
  {
    id: "evt_seed_1",
    repositoryId: "repo_tinker",
    owner: STR.maya,
    kind: "Progress",
    body: STR.pitchTagline,
    createdAt: hoursAgo(0.2),
    lane: "source",
  },
  {
    id: "evt_seed_2",
    repositoryId: "repo_tinker",
    owner: STR.jordan,
    kind: "Coverage",
    body: STR.techCoverageMap,
    createdAt: hoursAgo(3),
    lane: "tech",
  },
  {
    id: "evt_seed_3",
    repositoryId: "repo_feed",
    owner: STR.maya,
    kind: "Progress",
    body: STR.pitchSolution,
    createdAt: hoursAgo(8),
    lane: "source",
  },
  {
    id: "evt_seed_4",
    repositoryId: "repo_tinker",
    owner: STR.jordan,
    kind: "Connect",
    body: STR.techConnectFlow,
    createdAt: daysAgo(2),
    lane: "tech",
  },
  {
    id: "evt_seed_5",
    repositoryId: "repo_tinker",
    owner: STR.maya,
    kind: "Progress",
    body: STR.techExpoShell,
    createdAt: daysAgo(3),
    lane: "tech",
  },
  {
    id: "evt_seed_6",
    repositoryId: "repo_feed",
    owner: STR.jordan,
    kind: "Progress",
    body: STR.pitchProblem,
    createdAt: daysAgo(6),
    lane: "source",
  },
  {
    id: "evt_seed_7",
    repositoryId: "repo_feed",
    owner: STR.maya,
    kind: "Progress",
    body: STR.techFeedNoSource,
    createdAt: daysAgo(6),
    lane: "tech",
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

export function inferLane(event: ProgressEvent): IdeaLane {
  if (event.lane === "source" || event.lane === "tech") return event.lane;
  if (SOURCE_BODIES.has(event.body)) return "source";
  if (event.kind === "Coverage" || event.kind === "Connect") return "tech";
  return "tech";
}

export function toProgressCard(event: ProgressEvent): ProgressCard {
  const lane = inferLane(event);
  return {
    id: event.id,
    actor: event.owner?.trim() || STR.brand,
    kind: kindLabel(event.kind),
    body: event.body,
    when: formatWhen(event.createdAt),
    repoTitle: repoTitleFor(event.repositoryId),
    lane,
    laneLabel: lane === "source" ? STR.sourceIdea : STR.techIdea,
  };
}

export function cardsFromEvents(events: ProgressEvent[]): ProgressCard[] {
  return events.map(toProgressCard);
}
