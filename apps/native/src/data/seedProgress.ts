/**
 * Demo Explore / Activity rows for View 1.
 * Mix of source ideas (pitch) and tech ideas (product progress).
 */

import { STR } from "../strings";

export type DiscoverItem = {
  id: string;
  label: typeof STR.coverage | typeof STR.connect | typeof STR.progress;
  tint: "coverage" | "connect" | "progress";
};

export type ActivityItem = {
  id: string;
  actor: string;
  target: string;
  when: string;
  kind: typeof STR.progress | typeof STR.coverage | typeof STR.connect;
  title: string;
  detail: string;
  badge: typeof STR.aligned | typeof STR.sourceIdea | typeof STR.techIdea;
  lane: "source" | "tech";
};

export const DISCOVER_ITEMS: DiscoverItem[] = [
  { id: "d1", label: STR.coverage, tint: "coverage" },
  { id: "d2", label: STR.connect, tint: "connect" },
  { id: "d3", label: STR.progress, tint: "progress" },
];

export const ACTIVITY_ITEMS: ActivityItem[] = [
  {
    id: "a1",
    actor: STR.maya,
    target: STR.progress,
    when: STR.justNow,
    kind: STR.progress,
    title: STR.pitchTagline,
    detail: STR.someoneHere,
    badge: STR.sourceIdea,
    lane: "source",
  },
  {
    id: "a2",
    actor: STR.jordan,
    target: STR.coverage,
    when: STR.today,
    kind: STR.coverage,
    title: STR.techCoverageMap,
    detail: STR.techFeedNoSource,
    badge: STR.techIdea,
    lane: "tech",
  },
  {
    id: "a3",
    actor: STR.maya,
    target: STR.connect,
    when: STR.days3,
    kind: STR.connect,
    title: STR.pitchSolution,
    detail: STR.techConnectFlow,
    badge: STR.sourceIdea,
    lane: "source",
  },
  {
    id: "a4",
    actor: STR.jordan,
    target: STR.progress,
    when: STR.days6,
    kind: STR.progress,
    title: STR.techExpoShell,
    detail: STR.noSourceInFeed,
    badge: STR.techIdea,
    lane: "tech",
  },
];
