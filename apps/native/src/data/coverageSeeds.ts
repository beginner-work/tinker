/**
 * Side-by-side coverage rows for View 3.
 * Left column = verbatim founder / pitch lines.
 * Right column = repo path labels + allowlisted status (Aligned / Unaligned).
 * Gemma later organizes mapping; on-screen strings stay allowlisted or verbatim.
 */

import { STR } from "../strings";

export type CoverageStatus = "aligned" | "unaligned";

export type CoverageRow = {
  id: string;
  /** Verbatim founder / pitch line */
  idea: string;
  /** Repo path or surface name from the connected manifest — not prose */
  sourcePath: string;
  status: CoverageStatus;
};

export const COVERAGE_ROWS: CoverageRow[] = [
  {
    id: "c1",
    idea: STR.pitchTagline,
    sourcePath: "apps/native/App.tsx",
    status: "aligned",
  },
  {
    id: "c2",
    idea: STR.pitchProblem,
    sourcePath: "apps/native/src/screens/FirstOpenScreen.tsx",
    status: "aligned",
  },
  {
    id: "c3",
    idea: STR.pitchSolution,
    sourcePath: "apps/native/src/screens/FeedScreen.tsx",
    status: "aligned",
  },
  {
    id: "c4",
    idea: STR.noSourceInFeed,
    sourcePath: "apps/native/src/mcp/client.ts",
    status: "unaligned",
  },
];
