/**
 * One pitch idea per swipe page → multiple code files with high-level summaries.
 * idea = verbatim founder / pitch line
 * path = file path from the connected repository
 * summary = allowlisted high-level what-this-file-does line
 */

import { STR } from "../strings";

export type CoverageStatus = "aligned" | "unaligned";

export type CoverageFile = {
  path: string;
  summary: string;
  status: CoverageStatus;
};

export type CoveragePage = {
  id: string;
  idea: string;
  status: CoverageStatus;
  files: CoverageFile[];
};

export const COVERAGE_PAGES: CoveragePage[] = [
  {
    id: "c1",
    idea: STR.pitchTagline,
    status: "aligned",
    files: [
      {
        path: "apps/native/src/screens/FirstOpenScreen.tsx",
        summary: STR.fileSumFirstOpen,
        status: "aligned",
      },
      {
        path: "apps/native/App.tsx",
        summary: STR.fileSumAppShell,
        status: "aligned",
      },
      {
        path: "apps/native/src/strings.ts",
        summary: STR.fileSumStrings,
        status: "aligned",
      },
    ],
  },
  {
    id: "c2",
    idea: STR.pitchProblem,
    status: "aligned",
    files: [
      {
        path: "apps/native/src/screens/FirstOpenScreen.tsx",
        summary: STR.fileSumFirstOpen,
        status: "aligned",
      },
      {
        path: "apps/native/src/data/seedProgress.ts",
        summary: STR.fileSumSeedProgress,
        status: "aligned",
      },
    ],
  },
  {
    id: "c3",
    idea: STR.pitchSolution,
    status: "aligned",
    files: [
      {
        path: "apps/native/src/screens/FeedScreen.tsx",
        summary: STR.fileSumExplore,
        status: "aligned",
      },
      {
        path: "apps/native/src/screens/ConnectScreen.tsx",
        summary: STR.fileSumConnect,
        status: "aligned",
      },
      {
        path: "apps/native/src/mcp/client.ts",
        summary: STR.fileSumMcp,
        status: "aligned",
      },
    ],
  },
  {
    id: "c4",
    idea: STR.noSourceInFeed,
    status: "unaligned",
    files: [
      {
        path: "apps/native/src/screens/FeedScreen.tsx",
        summary: STR.fileSumExplore,
        status: "unaligned",
      },
      {
        path: "apps/native/src/data/seedProgress.ts",
        summary: STR.fileSumSeedProgress,
        status: "unaligned",
      },
    ],
  },
];

/** @deprecated use COVERAGE_PAGES */
export const COVERAGE_ROWS = COVERAGE_PAGES;
export type CoverageRow = CoveragePage;
