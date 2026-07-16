/**
 * Demo Explore / Activity rows for View 1.
 * Bodies are allowlisted UI strings or verbatim pitch lines.
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
  badge: typeof STR.aligned;
};

export const DISCOVER_ITEMS: DiscoverItem[] = [
  { id: "d1", label: STR.coverage, tint: "coverage" },
  { id: "d2", label: STR.connect, tint: "connect" },
  { id: "d3", label: STR.progress, tint: "progress" },
];

export const ACTIVITY_ITEMS: ActivityItem[] = [
  {
    id: "a1",
    actor: STR.brand,
    target: STR.coverage,
    when: STR.justNow,
    kind: STR.coverage,
    title: STR.pitchTagline,
    detail: STR.noSourceInFeed,
    badge: STR.aligned,
  },
  {
    id: "a2",
    actor: STR.brand,
    target: STR.progress,
    when: STR.today,
    kind: STR.progress,
    title: STR.pitchSolution,
    detail: STR.pitchProblem,
    badge: STR.aligned,
  },
  {
    id: "a3",
    actor: STR.brand,
    target: STR.connect,
    when: STR.days3,
    kind: STR.connect,
    title: STR.noSourceInFeed,
    detail: STR.emptyFeed,
    badge: STR.aligned,
  },
];
