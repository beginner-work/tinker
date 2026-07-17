/**
 * Demo Explore / Activity rows — each item pairs source idea + tech idea.
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
  sourceIdea: string;
  techIdea: string;
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
    sourceIdea: STR.pitchTagline,
    techIdea: STR.techExpoShell,
  },
  {
    id: "a2",
    actor: STR.jordan,
    target: STR.coverage,
    when: STR.today,
    kind: STR.coverage,
    sourceIdea: STR.pitchSolution,
    techIdea: STR.techCoverageMap,
  },
  {
    id: "a3",
    actor: STR.maya,
    target: STR.connect,
    when: STR.days3,
    kind: STR.connect,
    sourceIdea: STR.noSourceInFeed,
    techIdea: STR.techConnectFlow,
  },
  {
    id: "a4",
    actor: STR.jordan,
    target: STR.progress,
    when: STR.days6,
    kind: STR.progress,
    sourceIdea: STR.pitchProblem,
    techIdea: STR.techFeedNoSource,
  },
];
