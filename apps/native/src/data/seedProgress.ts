/**
 * Demo Explore / Activity — source idea in front, tech ideas stacked behind.
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
  techIdeas: string[];
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
    techIdeas: [STR.techExpoShell, STR.techFeedNoSource, STR.techCoverageMap],
  },
  {
    id: "a2",
    actor: STR.jordan,
    target: STR.coverage,
    when: STR.today,
    kind: STR.coverage,
    sourceIdea: STR.pitchSolution,
    techIdeas: [STR.techCoverageMap, STR.techConnectFlow],
  },
  {
    id: "a3",
    actor: STR.maya,
    target: STR.connect,
    when: STR.days3,
    kind: STR.connect,
    sourceIdea: STR.noSourceInFeed,
    techIdeas: [STR.techConnectFlow, STR.techFeedNoSource],
  },
];
