/**
 * Seed pitches + repositories for View 2 Connect.
 * Pitch titles/bodies are verbatim pitch lines; repo rows mirror MCP hub shape.
 */

import { STR } from "../strings";

export type PitchOption = {
  id: string;
  slug: string;
  title: string;
  summary: string;
};

export type RepoOption = {
  id: string;
  slug: string;
  title: string;
  installTool: string;
  pitchSlug: string | null;
  platforms: string[];
};

export type ConnectionState = {
  pitchSlug: string | null;
  repoSlug: string | null;
  connectedAt: string | null;
};

export const PITCH_OPTIONS: PitchOption[] = [
  {
    id: "p1",
    slug: "everyone-is-a-founder",
    title: STR.pitchTagline,
    summary: STR.pitchProblem,
  },
  {
    id: "p2",
    slug: "pitch-on-the-go",
    title: STR.pitchSolution,
    summary: STR.pitchTagline,
  },
];

export const REPO_OPTIONS: RepoOption[] = [
  {
    id: "r1",
    slug: "tinker-native",
    title: STR.brand,
    installTool: "repo_pull",
    pitchSlug: "everyone-is-a-founder",
    platforms: ["native", "web"],
  },
  {
    id: "r2",
    slug: "product-oriented-feed",
    title: STR.feed,
    installTool: "repo_register",
    pitchSlug: null,
    platforms: ["native"],
  },
];

export const EMPTY_CONNECTION: ConnectionState = {
  pitchSlug: null,
  repoSlug: null,
  connectedAt: null,
};
