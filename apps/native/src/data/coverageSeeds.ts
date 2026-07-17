/**
 * One orthogonal coverage pair per swipe page.
 * idea = verbatim founder / pitch line
 * surface = human place-in-the-app name (allowlisted) — not opaque slugs
 */

import { STR } from "../strings";

export type CoverageStatus = "aligned" | "unaligned";

export type CoverageRow = {
  id: string;
  idea: string;
  /** Human label for where this shows up in the app */
  surface: string;
  status: CoverageStatus;
};

export const COVERAGE_ROWS: CoverageRow[] = [
  {
    id: "c1",
    idea: STR.pitchTagline,
    surface: STR.surfaceFirstOpen,
    status: "aligned",
  },
  {
    id: "c2",
    idea: STR.pitchProblem,
    surface: STR.surfaceFirstOpen,
    status: "aligned",
  },
  {
    id: "c3",
    idea: STR.pitchSolution,
    surface: STR.explore,
    status: "aligned",
  },
  {
    id: "c4",
    idea: STR.noSourceInFeed,
    surface: STR.connect,
    status: "unaligned",
  },
];
