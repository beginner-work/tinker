/**
 * Progress feed — each founder source-idea card has multiple tech cards stacked behind it.
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
  lane?: IdeaLane;
};

/** One feed post: founder source idea in front, tech ideas stacked behind. */
export type ProgressCard = {
  id: string;
  actor: string;
  kind: string;
  when: string;
  repoTitle: string;
  sourceIdea: string;
  techIdeas: string[];
};

const NOW = Date.now();

function hoursAgo(h: number): string {
  return new Date(NOW - h * 3600_000).toISOString();
}

const SOURCE_BODIES = new Set<string>([
  STR.pitchTagline,
  STR.pitchProblem,
  STR.pitchSolution,
  STR.noSourceInFeed,
  STR.yourWords,
]);

/** Seed posts: one source card + multiple tech cards behind. */
export const SEED_PROGRESS_CARDS: ProgressCard[] = [
  {
    id: "card_1",
    actor: STR.maya,
    kind: STR.progress,
    when: STR.justNow,
    repoTitle: STR.brand,
    sourceIdea: STR.pitchTagline,
    techIdeas: [
      STR.techExpoShell,
      STR.techFeedNoSource,
      STR.techCoverageMap,
    ],
  },
  {
    id: "card_2",
    actor: STR.jordan,
    kind: STR.coverage,
    when: STR.today,
    repoTitle: STR.brand,
    sourceIdea: STR.pitchSolution,
    techIdeas: [STR.techCoverageMap, STR.techConnectFlow],
  },
  {
    id: "card_3",
    actor: STR.maya,
    kind: STR.connect,
    when: STR.days3,
    repoTitle: STR.feed,
    sourceIdea: STR.noSourceInFeed,
    techIdeas: [STR.techConnectFlow, STR.techFeedNoSource],
  },
  {
    id: "card_4",
    actor: STR.jordan,
    kind: STR.progress,
    when: STR.days6,
    repoTitle: STR.brand,
    sourceIdea: STR.pitchProblem,
    techIdeas: [STR.techExpoShell, STR.techFeedNoSource],
  },
];

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
  return "tech";
}

/**
 * Group hub events: each source idea becomes a front card with all
 * matching tech ideas stacked behind (same owner + repo).
 */
export function cardsFromEvents(events: ProgressEvent[]): ProgressCard[] {
  if (events.length === 0) return [];

  const byOwner = new Map<string, ProgressEvent[]>();
  for (const e of events) {
    const key = (e.owner?.trim() || STR.brand) + "|" + e.repositoryId;
    const list = byOwner.get(key) ?? [];
    list.push(e);
    byOwner.set(key, list);
  }

  const cards: ProgressCard[] = [];
  for (const [, group] of byOwner) {
    const sorted = [...group].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const sources = sorted.filter((e) => inferLane(e) === "source");
    const techs = sorted
      .filter((e) => inferLane(e) === "tech")
      .map((e) => e.body)
      .filter(Boolean);

    if (sources.length === 0 || techs.length === 0) continue;

    for (const src of sources) {
      cards.push({
        id: src.id,
        actor: src.owner?.trim() || STR.brand,
        kind: kindLabel(src.kind),
        when: formatWhen(src.createdAt),
        repoTitle: repoTitleFor(src.repositoryId),
        sourceIdea: src.body,
        techIdeas: techs,
      });
    }
  }

  return cards.length > 0 ? cards : SEED_PROGRESS_CARDS;
}

/** @deprecated unused — kept for event-shaped fixtures */
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
    id: "evt_seed_1b",
    repositoryId: "repo_tinker",
    owner: STR.maya,
    kind: "Progress",
    body: STR.techExpoShell,
    createdAt: hoursAgo(0.2),
    lane: "tech",
  },
];
